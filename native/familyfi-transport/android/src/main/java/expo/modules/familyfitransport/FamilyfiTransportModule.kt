package expo.modules.familyfitransport

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.Inet4Address
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Connection
import okhttp3.EventListener
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
 *
 * Every client shares one connection pool, and each pin keeps one client for the app's life. OkHttp
 * reuses a pooled connection only for the same socket factory and hostname verifier, so a client
 * built afresh per request never reused a pinned route's connection; a cached one does. A route's
 * TCP and TLS handshake is then paid once, and a server that offers HTTP/2 (Cloudflare, and most
 * reverse proxies) carries every request over one connection: OkHttp negotiates it by ALPN wherever
 * the server offers it, and keeps HTTP/1.1 connections alive otherwise. A pinned client's pooled
 * connections all matched its pin when they were made.
 */
class FamilyfiTransportModule : Module() {
  private val systemClient: OkHttpClient by lazy { OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build() }
  private val pinnedClients = ConcurrentHashMap<String, OkHttpClient>()

  override fun definition() = ModuleDefinition {
    Name("FamilyfiTransport")

    Events("onNetwork")

    OnCreate {
      val manager = appContext.reactContext?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
      if (manager != null) {
        val callback = object : ConnectivityManager.NetworkCallback() {
          override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) =
            update(describe(capabilities, manager.getLinkProperties(network)))

          override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) =
            update(describe(manager.getNetworkCapabilities(network), properties))

          override fun onLost(network: Network) = update(mapOf("kind" to "other"))
        }
        manager.registerDefaultNetworkCallback(callback)
        networkCallback = callback
        connectivity = manager
      }
    }

    OnDestroy {
      networkCallback?.let { connectivity?.unregisterNetworkCallback(it) }
      networkCallback = null
    }

    /** The network the phone is on now (familyfi `DeviceNetwork`), for the session's route order. */
    Function("network") {
      val manager = connectivity
      val active = manager?.activeNetwork
      if (manager == null || active == null) {
        latest
      } else {
        describe(manager.getNetworkCapabilities(active), manager.getLinkProperties(active)).also { latest = it }
      }
    }

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
        pinnedClients.getOrPut(pin) { pinnedClient(pin) }
      } else {
        systemClient
      }.newBuilder().callTimeout(options.timeoutMs.toLong(), TimeUnit.MILLISECONDS).apply {
        // Only for a request that can move to another route (familyfi `LAN_CONNECT_TIMEOUT_MS`).
        // OkHttp's connectTimeout covers the TCP connect alone (the TLS handshake runs under the read
        // timeout), so a watchdog cancels the call unless a connection, handshake included, or a
        // pooled one is acquired in time.
        val connectMs = options.connectTimeoutMs
        if (connectMs != null && connectMs > 0 && connectMs < options.timeoutMs) {
          connectTimeout(connectMs.toLong(), TimeUnit.MILLISECONDS)
          eventListener(ConnectWatchdog(connectMs.toLong()))
        }
      }.build()

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

  private var connectivity: ConnectivityManager? = null
  private var networkCallback: ConnectivityManager.NetworkCallback? = null

  @Volatile private var latest: Map<String, String> = mapOf("kind" to "other")

  private fun update(next: Map<String, String>) {
    if (next == latest) return
    latest = next
    sendEvent("onNetwork", next)
  }

  /**
   * `wifi` for Wi-Fi or Ethernet, `cellular`, else `other`: a VPN (over which a home route may
   * answer, so it keeps the manifest's order), or no network. A Wi-Fi network's `key` is its IPv4
   * subnet, which needs no location permission, unlike its name.
   */
  private fun describe(capabilities: NetworkCapabilities?, properties: LinkProperties?): Map<String, String> {
    if (capabilities == null || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return mapOf("kind" to "other")
    if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
      val subnet = properties?.linkAddresses?.firstOrNull { it.address is Inet4Address }?.let { link ->
        val ip = link.address.address.fold(0L) { value, byte -> (value shl 8) or (byte.toLong() and 0xff) }
        val prefix = link.prefixLength
        val mask = if (prefix == 0) 0L else (0xffffffffL shl (32 - prefix)) and 0xffffffffL
        val network = ip and mask
        "${network shr 24}.${(network shr 16) and 0xff}.${(network shr 8) and 0xff}.${network and 0xff}/$prefix"
      }
      return if (subnet != null) mapOf("kind" to "wifi", "key" to subnet) else mapOf("kind" to "wifi")
    }
    if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return mapOf("kind" to "cellular")
    return mapOf("kind" to "other")
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

/** Cancels a call that has not acquired a connection (TCP and TLS, or a pooled one) within `limitMs`. */
private class ConnectWatchdog(private val limitMs: Long) : EventListener() {
  @Volatile private var pending: ScheduledFuture<*>? = null

  override fun callStart(call: Call) {
    pending = timers.schedule({ call.cancel() }, limitMs, TimeUnit.MILLISECONDS)
  }

  override fun connectionAcquired(call: Call, connection: Connection) = stop()

  override fun callEnd(call: Call) = stop()

  override fun callFailed(call: Call, ioe: IOException) = stop()

  private fun stop() {
    pending?.cancel(false)
    pending = null
  }

  companion object {
    private val timers = Executors.newSingleThreadScheduledExecutor { runnable ->
      Thread(runnable, "familyfi-transport-connect").apply { isDaemon = true }
    }
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

  /** How long to wait for the connection itself (familyfi `LAN_CONNECT_TIMEOUT_MS`), when set. */
  @Field val connectTimeoutMs: Double? = null
}

