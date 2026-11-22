package com.getfamilyfi.watchsession

import com.google.crypto.tink.subtle.Ed25519Verify
import java.net.URI
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.util.Base64
import org.json.JSONObject

// How the watch trusts its household, as the phone does (familyfi `src/lib/companion-trust.ts`) and
// as `FFTrust.swift` beside it ports it for watchOS: the routes come only from a manifest the household's
// Ed25519 key signed, a pinned route trusts only its pinned key, and an Access credential goes only to
// its own route. Ed25519 is Tink's: Wear OS offers none of its own outside Android Keystore.

data class FFRoute(
  val id: String,
  val url: String,
  val transport: String,
  /** `system` or `pinned`. */
  val trustMode: String,
  val spkiSha256: String?,
  val priority: Int,
  val enabled: Boolean,
  val edgeAuth: String?,
  val edgeTokenVersion: Int?,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("id", id).put("url", url).put("transport", transport).put("trustMode", trustMode)
    .put("spkiSha256", spkiSha256 ?: JSONObject.NULL).put("priority", priority).put("enabled", enabled)
    .put("edgeAuth", edgeAuth ?: JSONObject.NULL).put("edgeTokenVersion", edgeTokenVersion ?: JSONObject.NULL)

  companion object {
    fun from(json: JSONObject) = FFRoute(
      id = json.getString("id"),
      url = json.getString("url"),
      transport = json.optString("transport"),
      trustMode = json.getString("trustMode").also { require(it == "system" || it == "pinned") { "Unknown trust mode." } },
      spkiSha256 = json.stringOrNull("spkiSha256"),
      priority = json.optInt("priority"),
      enabled = json.optBoolean("enabled"),
      edgeAuth = json.stringOrNull("edgeAuth"),
      edgeTokenVersion = if (json.isNull("edgeTokenVersion")) null else json.getInt("edgeTokenVersion"),
    )
  }
}

data class FFEndpointCredential(val endpointId: String, val version: Int, val clientId: String, val clientSecret: String) {
  fun toJson(): JSONObject = JSONObject().put("endpointId", endpointId).put("version", version).put("clientId", clientId).put("clientSecret", clientSecret)

  override fun toString() = "Access credential (redacted)"

  companion object {
    fun from(json: JSONObject) = FFEndpointCredential(json.getString("endpointId"), json.getInt("version"), json.getString("clientId"), json.getString("clientSecret"))
  }
}

class FFTrustException(val reason: Reason) : Exception(reason.message) {
  enum class Reason(val message: String) {
    SIGNATURE("FamilyFi's connection details are not signed by this household."),
    WRONG_HOUSEHOLD("FamilyFi's connection details are for another household."),
    INVALID("FamilyFi returned invalid connection details."),
  }
}

data class FFVerifiedManifest(val endpoints: List<FFRoute>, val edgeCredentials: List<FFEndpointCredential>)

object FFTrust {
  /** Routes tried in order: enabled ones, the one that last answered first. */
  fun candidates(routes: List<FFRoute>, lastAnswered: String?): List<FFRoute> {
    val enabled = routes.filter { it.enabled }
    return enabled.filter { it.id == lastAnswered } + enabled.filter { it.id != lastAnswered }
  }

  /** `verifyManifest`: the signed payload, checked against the household's key, names this household. */
  fun verifyManifest(signedPayload: String, signature: String, publicKeyX: String, instanceId: String): FFVerifiedManifest {
    val payload = base64UrlData(signedPayload)
    val signatureData = base64UrlData(signature)
    val keyData = base64UrlData(publicKeyX)
    if (payload == null || signatureData == null || keyData == null || keyData.size != 32 || !verifies(keyData, payload, signatureData)) {
      throw FFTrustException(FFTrustException.Reason.SIGNATURE)
    }
    val body = runCatching { JSONObject(String(payload, Charsets.UTF_8)) }.getOrNull() ?: throw FFTrustException(FFTrustException.Reason.SIGNATURE)
    if (body.optString("instanceId") != instanceId) throw FFTrustException(FFTrustException.Reason.WRONG_HOUSEHOLD)
    val parsed = runCatching {
      body.getJSONArray("endpoints").objects().map(FFRoute::from) to body.optJSONArray("edgeCredentials").objects().map(FFEndpointCredential::from)
    }.getOrNull() ?: throw FFTrustException(FFTrustException.Reason.SIGNATURE)
    validate(parsed.first, parsed.second)
    return FFVerifiedManifest(parsed.first, parsed.second)
  }

  /**
   * Ed25519 with the raw 32-byte key, in Tink's own Java: Wear OS has no software Ed25519 to ask for,
   * and Android Keystore answers instead, refusing any key it did not make.
   */
  private fun verifies(rawKey: ByteArray, payload: ByteArray, signature: ByteArray): Boolean = try {
    Ed25519Verify(rawKey).verify(signature, payload)
    true
  } catch (_: GeneralSecurityException) {
    // Only a signature that does not verify: anything else reaches the caller, and the watch's log.
    false
  }

  /** `validateManifest`: HTTPS origins, a pin on every pinned route, unique ids, and each route's Access binding. */
  fun validate(endpoints: List<FFRoute>, credentials: List<FFEndpointCredential>) {
    val invalid = FFTrustException(FFTrustException.Reason.INVALID)
    if (endpoints.map { it.id }.toSet().size != endpoints.size || credentials.map { it.endpointId }.toSet().size != credentials.size) throw invalid
    for (endpoint in endpoints) {
      if (!isServerOrigin(endpoint.url)) throw invalid
      if (endpoint.trustMode == "pinned" && (endpoint.spkiSha256 == null || !isPin(endpoint.spkiSha256))) throw invalid
      val credential = credentials.firstOrNull { it.endpointId == endpoint.id }
      if (endpoint.edgeAuth == "serviceToken") {
        if (endpoint.transport != "cloudflare" || endpoint.trustMode != "system" || credential == null || credential.version <= 0 ||
          credential.version != endpoint.edgeTokenVersion || !headerSafe(credential.clientId) || !headerSafe(credential.clientSecret)
        ) throw invalid
      } else if (credential != null || endpoint.edgeTokenVersion != null) {
        throw invalid
      }
    }
    if (!credentials.all { credential -> endpoints.any { it.id == credential.endpointId } }) throw invalid
  }

  /** `edgeHeaders`: a route's Access credential, only on that route and only at its version. */
  fun edgeHeaders(route: FFRoute, credentials: List<FFEndpointCredential>): Map<String, String> {
    if (route.edgeAuth != "serviceToken") return emptyMap()
    val credential = credentials.firstOrNull { it.endpointId == route.id && it.version == route.edgeTokenVersion } ?: return emptyMap()
    return mapOf("CF-Access-Client-Id" to credential.clientId, "CF-Access-Client-Secret" to credential.clientSecret)
  }

  /** `isEdgeUnavailable`: Cloudflare Access answered, not FamilyFi. The route is unavailable: try the next. */
  fun isEdgeUnavailable(status: Int, location: String?, body: String): Boolean {
    if (status in 300 until 400) {
      return location?.let { runCatching { URI(it).host?.endsWith(".cloudflareaccess.com") }.getOrNull() } ?: false
    }
    if (status != 401 && status != 403) return false
    return errorCode(body) == null
  }

  /**
   * How long a refresh waits on one route before trying the next (familyfi `companion-request.ts`
   * `REFRESH_TIMEOUT_MS`). A server from 1.1.0 honours the token a refresh just replaced until the
   * new pair is used; older ones only within a 10 s grace, which two routes' attempts fit, so a
   * reply lost on one route can still be retried on the next.
   */
  const val REFRESH_TIMEOUT_SECONDS = 5L

  /** Every other request's wait per route. */
  const val REQUEST_TIMEOUT_SECONDS = 15L

  /**
   * The household refused a call outside the device's scope: 403 `watch_scope` for a watch
   * (`app-watch`, `app:rulesOnly`), 403 `app_scope` for the phone's Quick Settings tiles (`app:rulesOnly`), 403 `me_scope` for FamilyFi Me's watch (`me-watch`), which
   * use this client too. Only that: the session stays, so this never renews or signs the device out.
   */
  fun isScopeRefusal(status: Int, body: String): Boolean = status == 403 && errorCode(body) in SCOPE_REFUSALS

  private val SCOPE_REFUSALS = setOf("watch_scope", "app_scope", "me_scope")

  /**
   * The server refused a refresh token itself (familyfi `companion-session.ts` `refused`): only this
   * signs the watch out. A server that fails to answer (5xx, 429) leaves the session to try again.
   */
  fun refusesRefresh(status: Int): Boolean = status == 400 || status == 401 || status == 403

  /**
   * A pinned route's TLS decision: trusted only when the leaf certificate's SubjectPublicKeyInfo
   * hashes to the pin. No leaf, an unreadable key or another key fails closed.
   */
  fun trusts(leaf: X509Certificate?, pin: String): Boolean {
    if (leaf == null || pin.isEmpty()) return false
    return runCatching { spkiSha256(leaf) == pin }.getOrDefault(false)
  }

  fun isServerOrigin(value: String): Boolean {
    val uri = runCatching { URI(value) }.getOrNull() ?: return false
    return uri.scheme == "https" && !uri.host.isNullOrEmpty() && (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/") &&
      uri.rawQuery == null && uri.rawFragment == null && uri.rawUserInfo == null
  }

  /** The `{ error: { code } }` of a FamilyFi refusal, or null when FamilyFi did not write the body. */
  fun errorCode(body: String): String? = runCatching { JSONObject(body).getJSONObject("error").getString("code") }.getOrNull()

  /** A pin is 43 base64url characters: `/^[A-Za-z0-9_-]{43}$/`. */
  private fun isPin(value: String) = value.length == 43 && value.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '-' || it == '_' }

  private fun headerSafe(value: String) = value.isNotEmpty() && value.length <= 512 && value.all { it.code in 33..126 }
}

fun base64UrlData(value: String): ByteArray? = runCatching { Base64.getUrlDecoder().decode(value.trimEnd('=')) }.getOrNull()

fun base64Url(data: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(data)

/** The base64url SHA-256 of a certificate's SubjectPublicKeyInfo, as the server's pins are written. */
fun spkiSha256(certificate: X509Certificate): String = base64Url(MessageDigest.getInstance("SHA-256").digest(certificate.publicKey.encoded))

/** A string field, or null when it is absent or JSON null (`optString` would answer "null"). */
internal fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else optString(key)

internal fun org.json.JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else List(length()) { getJSONObject(it) }
