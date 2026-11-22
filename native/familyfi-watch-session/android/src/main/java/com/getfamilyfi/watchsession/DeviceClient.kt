package com.getfamilyfi.watchsession

import java.io.IOException
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.time.Instant
import java.time.OffsetDateTime
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

// The `/api/v1` client of a paired watch that holds its own session, as `FFDeviceClient.swift` is
// on watchOS: its trusted routes, its own bearer, refresh. Shared by the FamilyFi app's Wear OS app and
// FamilyFi Me's, each of which adds the calls its scope allows. It mirrors the phone's (familyfi
// `companion-request.ts` and `companion-session.ts`): reads and the refresh fail over to the next
// route, a household write never does; a bearer about to expire is renewed first, and a refused one is
// renewed and the request sent once more; a refused refresh token signs the device out, while a server
// that fails to answer (5xx, 429) leaves the session to try again. A call outside its scope (403
// `watch_scope`, `app_scope` or `me_scope`) is only that: it never renews or signs the device out.
// Only paths under /api/v1 are ever sent.

/** The words each failure carries, in the app's own copy. */
data class FFDeviceWords(val unreachable: String, val signedOut: String, val notAllowed: String, val unexpected: String, val refused: String)

sealed class FFDeviceException(message: String) : Exception(message) {
  /** No route answered. */
  class Unreachable(message: String) : FFDeviceException(message)

  /** The household no longer accepts this device's session: it must be set up again. */
  class SignedOut(message: String) : FFDeviceException(message)

  /** The device's scope does not allow the call; it stays signed in. */
  class NotAllowed(message: String) : FFDeviceException(message)

  /** FamilyFi answered with an error: its status, its words and its code when it sent one. */
  class Server(val status: Int, message: String, val code: String?) : FFDeviceException(message)
}

/** The device's signed-in session, renewed in place as its bearer is. */
data class FFDeviceSession(
  val deviceId: String,
  val token: String,
  val expiresAt: String,
  val refreshToken: String,
  val instanceId: String,
  val publicKeyX: String,
  val endpoints: List<FFRoute>,
  val edgeCredentials: List<FFEndpointCredential>,
  val lastAnswered: String?,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("deviceId", deviceId).put("token", token).put("expiresAt", expiresAt).put("refreshToken", refreshToken)
    .put("instanceId", instanceId).put("publicKeyX", publicKeyX)
    .put("endpoints", JSONArray(endpoints.map { it.toJson() }))
    .put("edgeCredentials", JSONArray(edgeCredentials.map { it.toJson() }))
    .put("lastAnswered", lastAnswered ?: JSONObject.NULL)

  companion object {
    fun from(json: JSONObject) = FFDeviceSession(
      json.getString("deviceId"), json.getString("token"), json.getString("expiresAt"), json.getString("refreshToken"),
      json.getString("instanceId"), json.getString("publicKeyX"),
      json.getJSONArray("endpoints").objects().map(FFRoute::from),
      json.getJSONArray("edgeCredentials").objects().map(FFEndpointCredential::from),
      json.stringOrNull("lastAnswered"),
    )

    /**
     * The session the phone's provisioning (familyfi `WatchProvisioning` in `src/lib/watch.ts`)
     * gives, only when it is for the watch with this id, complete, and its manifest is signed by the
     * household's key and lists a route. Anything else is refused.
     */
    fun fromProvisioning(json: String, watchId: String): FFDeviceSession {
      val invalid = FFTrustException(FFTrustException.Reason.INVALID)
      val provisioning = runCatching { JSONObject(json) }.getOrNull() ?: throw invalid
      val trust = provisioning.optJSONObject("trust") ?: throw invalid
      val manifest = provisioning.optJSONObject("manifest") ?: throw invalid
      val fields = listOf("deviceId", "token", "expiresAt", "refreshToken").associateWith { provisioning.optString(it) }
      val instanceId = trust.optString("instanceId")
      val publicKeyX = trust.optString("publicKeyX")
      if (!provisioning.optString("watchId").equals(watchId, ignoreCase = true) || fields.values.any { it.isEmpty() } || instanceId.isEmpty() || publicKeyX.isEmpty()) throw invalid
      val verified = FFTrust.verifyManifest(manifest.optString("signedPayload"), manifest.optString("signature"), publicKeyX, instanceId)
      if (verified.endpoints.none { it.enabled }) throw invalid
      return FFDeviceSession(
        fields.getValue("deviceId"), fields.getValue("token"), fields.getValue("expiresAt"), fields.getValue("refreshToken"),
        instanceId, publicKeyX, verified.endpoints, verified.edgeCredentials, null,
      )
    }
  }
}

/** Where a client keeps its session. */
interface FFSessionStore {
  val session: FFDeviceSession?

  /**
   * Changes the stored session in one step, so concurrent requests never write back a token another
   * has replaced. [change] sees the session as stored now; null leaves it as it is.
   */
  fun updateSession(change: (FFDeviceSession) -> FFDeviceSession?)

  /** Signed out: the household ended this session. */
  fun clear()
}

/** ISO 8601 instants as JavaScript's `Date.toISOString()` writes them. */
internal fun isoDate(value: String): Instant? = runCatching { OffsetDateTime.parse(value).toInstant() }.getOrNull()

class FFDeviceClient(private val store: FFSessionStore, private val words: FFDeviceWords) {
  private val renewLock = Mutex()
  private var renewing: CompletableDeferred<Unit>? = null
  private val base = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build()

  /** A write under `/api/v1`, resolving to its answer's body. */
  suspend fun post(path: String, body: JSONObject = JSONObject()): String = send(path, "POST", body)

  /** Re-reads the routes, keeping them only from a manifest this household's key signed. */
  suspend fun refreshRoutes() {
    // Unreachable, signed out or refused reach the caller as they are; only the manifest is checked here.
    val data = send("/api/v1/connection", "GET", null)
    val answer = runCatching { JSONObject(data).getJSONObject("endpointManifest") }.getOrNull()
    val session = store.session
    if (answer == null || session == null) throw FFTrustException(FFTrustException.Reason.INVALID)
    val verified = FFTrust.verifyManifest(answer.getString("signedPayload"), answer.getString("signature"), session.publicKeyX, session.instanceId)
    store.updateSession {
      // A new setup since the check (another household, or this one again) keeps its own routes.
      if (it.deviceId != session.deviceId || it.instanceId != session.instanceId || it.publicKeyX != session.publicKeyX) null
      else if (verified.endpoints == it.endpoints && verified.edgeCredentials == it.edgeCredentials) null
      else it.copy(endpoints = verified.endpoints, edgeCredentials = verified.edgeCredentials)
    }
  }

  suspend fun get(path: String): JSONObject {
    val data = send(path, "GET", null)
    return runCatching { JSONObject(data) }.getOrElse { throw FFDeviceException.Server(200, words.unexpected, null) }
  }

  /** Sends with the device's bearer, renewing it first when it is about to expire, and once more after a 401. */
  suspend fun send(path: String, method: String, body: JSONObject?): String {
    val session = store.session ?: throw FFDeviceException.SignedOut(words.signedOut)
    val expires = isoDate(session.expiresAt)
    if (expires != null && expires.isBefore(Instant.now().plusSeconds(60))) {
      // Unreachable, or the server failed to answer: left to the request itself.
      try {
        renew()
      } catch (_: FFDeviceException.Unreachable) {
      } catch (_: FFDeviceException.Server) {
      }
    }
    val sentWith = store.session?.token
    return try {
      attempt(path, method, body, sentWith)
    } catch (error: FFDeviceException.Server) {
      if (error.status != 401) throw error
      // Another request may have renewed meanwhile: then resend with its bearer, without renewing again.
      if (store.session?.token == sentWith) renew()
      attempt(path, method, body, store.session?.token)
    }
  }

  /** One renewal at a time, so a refresh token is never spent twice. */
  private suspend fun renew() {
    val (pending, mine) = renewLock.withLock {
      renewing?.let { it to false } ?: CompletableDeferred<Unit>().also { renewing = it }.let { it to true }
    }
    if (!mine) return pending.await()
    try {
      renewNow()
      pending.complete(Unit)
    } catch (error: Throwable) {
      pending.completeExceptionally(error)
      throw error
    } finally {
      renewLock.withLock { renewing = null }
    }
  }

  private suspend fun renewNow() {
    val held = store.session ?: throw FFDeviceException.SignedOut(words.signedOut)
    val data = try {
      attempt("/api/v1/auth/refresh", "POST", JSONObject().put("refreshToken", held.refreshToken), null)
    } catch (error: FFDeviceException.Server) {
      if (!FFTrust.refusesRefresh(error.status)) throw error
      // Spent, reused, revoked or expired: the household has ended this device's session.
      store.clear()
      throw FFDeviceException.SignedOut(words.signedOut)
    }
    val answer = runCatching { JSONObject(data) }.getOrNull() ?: return
    store.updateSession { current ->
      if (current.refreshToken != held.refreshToken) null
      else current.copy(
        token = answer.getString("token"),
        refreshToken = answer.getString("refreshToken"),
        expiresAt = answer.getJSONObject("session").getString("expiresAt"),
      )
    }
  }

  /**
   * Tries each route in order. A read or a refresh that cannot reach a route, or meets an Access
   * wall, moves on; a household write never does, since it may have landed.
   */
  suspend fun attempt(path: String, method: String, body: JSONObject?, bearer: String?): String = withContext(Dispatchers.IO) {
    require(path.startsWith("/api/v1/")) { "Only the household API" }
    val session = store.session ?: throw FFDeviceException.SignedOut(words.signedOut)
    val refresh = path == "/api/v1/auth/refresh"
    val retryable = method == "GET" || refresh
    for (route in FFTrust.candidates(session.endpoints, session.lastAnswered)) {
      // A pinned route with no pin fails closed.
      if (route.trustMode == "pinned" && route.spkiSha256 == null) continue
      val request = Request.Builder().url(route.url + path).apply {
        header("Accept", "application/json")
        FFTrust.edgeHeaders(route, session.edgeCredentials).forEach { (name, value) -> header(name, value) }
        if (bearer != null) header("Authorization", "Bearer $bearer")
        method(method, body?.toString()?.toRequestBody("application/json".toMediaType()))
      }.build()
      val timeout = if (refresh) FFTrust.REFRESH_TIMEOUT_SECONDS else FFTrust.REQUEST_TIMEOUT_SECONDS
      val (status, location, text) = try {
        client(route).newBuilder().callTimeout(timeout, TimeUnit.SECONDS).build().newCall(request).execute().use {
          Triple(it.code, it.header("Location"), it.body?.string().orEmpty())
        }
      } catch (_: IOException) {
        if (retryable) continue
        throw FFDeviceException.Unreachable(words.unreachable)
      }
      if (FFTrust.isEdgeUnavailable(status, location, text)) {
        if (retryable) continue
        throw FFDeviceException.Unreachable(words.unreachable)
      }
      store.updateSession { if (it.lastAnswered == route.id) null else it.copy(lastAnswered = route.id) }
      if (status !in 200 until 300) {
        if (FFTrust.isScopeRefusal(status, text)) throw FFDeviceException.NotAllowed(words.notAllowed)
        val message = runCatching { JSONObject(text).getJSONObject("error").getString("message") }.getOrNull()
        // Every error FamilyFi sends says what went wrong. A server error without those words came
        // from something on the way (a tunnel or proxy), so FamilyFi was not reached.
        if (message == null && status >= 500) throw FFDeviceException.Unreachable(words.unreachable)
        throw FFDeviceException.Server(status, message ?: words.refused, FFTrust.errorCode(text))
      }
      return@withContext text
    }
    throw FFDeviceException.Unreachable(words.unreachable)
  }

  /**
   * One route's TLS: a pinned route trusts only the leaf whose SubjectPublicKeyInfo hashes to its
   * pin, and never falls back to system trust; a system route uses the platform's own checks.
   * Redirects are never followed, so a Cloudflare Access sign-in reads as the route being unavailable.
   */
  private fun client(route: FFRoute): OkHttpClient {
    val pin = route.spkiSha256.takeIf { route.trustMode == "pinned" } ?: return base
    val trustManager = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = throw CertificateException("Client certificates are not used.")

      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        if (!FFTrust.trusts(chain?.firstOrNull(), pin)) throw CertificateException("The server's certificate does not match this route's pin.")
      }

      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
    val context = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustManager), null) }
    // The hostname check passes only because the pin already matched.
    return base.newBuilder().sslSocketFactory(context.socketFactory, trustManager).hostnameVerifier { _, _ -> true }.build()
  }
}
