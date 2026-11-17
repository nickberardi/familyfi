package expo.modules.familyfitransport

import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.ByteArrayInputStream
import java.io.IOException
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/**
 * HTTPS to one household route. A pinned route trusts only a leaf certificate whose SPKI SHA-256
 * equals the pin: no chain evaluation, no hostname check, and an empty pin fails. OkHttp's
 * CertificatePinner is not enough, because it still requires a system-trusted chain. A system route
 * uses the platform's trust. Redirects are returned, never followed. Any failure without a response
 * rejects with E_TRANSPORT.
 */
class FamilyfiTransportModule : Module() {
  private val systemClient: OkHttpClient by lazy { OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build() }

  override fun definition() = ModuleDefinition {
    Name("FamilyfiTransport")

    AsyncFunction("request") { options: TransportRequest, promise: Promise ->
      if (!options.url.startsWith("https://")) {
        promise.reject("E_TRANSPORT", "Not an HTTPS URL.", null)
        return@AsyncFunction
      }
      val client = if (options.trustMode == "pinned") {
        val pin = options.pin
        if (pin.isNullOrEmpty()) {
          promise.reject("E_TRANSPORT", "A pinned route has no pin.", null)
          return@AsyncFunction
        }
        pinnedClient(pin)
      } else {
        systemClient
      }.newBuilder().callTimeout(options.timeoutMs.toLong(), TimeUnit.MILLISECONDS).build()

      val contentType = options.headers.entries.firstOrNull { it.key.equals("Content-Type", ignoreCase = true) }?.value ?: "application/json"
      val body = options.body?.toRequestBody(contentType.toMediaType())
      val request = Request.Builder().url(options.url).apply {
        options.headers.forEach { (name, value) -> header(name, value) }
        method(options.method, body ?: if (options.method == "POST" || options.method == "PUT" || options.method == "PATCH") ByteArray(0).toRequestBody(null) else null)
      }.build()

      client.newCall(request).enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
          promise.reject("E_TRANSPORT", e.message ?: "No response.", e)
        }

        override fun onResponse(call: Call, response: Response) {
          response.use {
            val headers = mutableMapOf<String, String>()
            for (name in it.headers.names()) headers[name] = it.headers(name).joinToString(", ")
            promise.resolve(mapOf("status" to it.code, "headers" to headers, "body" to (it.body?.string() ?: "")))
          }
        }
      })
    }

    Function("spkiPin") { certificateBase64: String ->
      val der = Base64.decode(certificateBase64, Base64.DEFAULT)
      val certificate = CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as X509Certificate
      spkiPin(certificate)
    }
  }

  /** A client that trusts only a leaf whose SPKI hash is `pin`; its hostname check passes only because the pin already matched. */
  private fun pinnedClient(pin: String): OkHttpClient {
    val trustManager = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = throw CertificateException("Client certificates are not used.")

      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("No server certificate.")
        if (spkiPin(leaf) != pin) throw CertificateException("The server's certificate does not match this route's pin.")
      }

      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
    val context = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustManager), null) }
    return systemClient.newBuilder()
      .sslSocketFactory(context.socketFactory, trustManager)
      .hostnameVerifier { _, _ -> true }
      .build()
  }
}

/** base64url SHA-256 of the certificate's SubjectPublicKeyInfo (`publicKey.encoded` is that DER). */
internal fun spkiPin(certificate: X509Certificate): String {
  val digest = MessageDigest.getInstance("SHA-256").digest(certificate.publicKey.encoded)
  return Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}

class TransportRequest : Record {
  @Field val url: String = ""
  @Field val method: String = "GET"
  @Field val headers: Map<String, String> = emptyMap()
  @Field val body: String? = null
  @Field val trustMode: String = "system"
  @Field val pin: String? = null
  @Field val timeoutMs: Double = 15_000.0
}

