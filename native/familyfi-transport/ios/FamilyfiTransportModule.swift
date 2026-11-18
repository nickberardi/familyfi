import CryptoKit
import ExpoModulesCore
import Foundation
import Network
import Security

/// HTTPS to one household route. A pinned route trusts only a leaf certificate whose SPKI SHA-256
/// equals the pin: no system evaluation, no hostname check, and an empty pin fails. A system route
/// uses URLSession's normal trust. Redirects are returned, never followed, so a Cloudflare Access
/// sign-in redirect reaches JavaScript as a 3xx. Any failure without a response rejects.
///
/// Requests to the same trust (the system's, or one pin) share one `URLSession` for the app's life,
/// so they share its connections: a route's TCP and TLS handshake is paid once, not per request, and
/// a server that offers HTTP/2 (Cloudflare, and most reverse proxies) carries every request over one
/// connection. URLSession negotiates HTTP/2 itself, by ALPN, wherever the server offers it, and
/// keeps HTTP/1.1 connections alive otherwise. A pinned session only ever holds connections whose
/// leaf matched its pin, since the pin is checked on each new connection's handshake.
public class FamilyfiTransportModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FamilyfiTransport")

    Events("onNetwork")

    OnCreate {
      DeviceNetwork.shared.onChange = { [weak self] network in self?.sendEvent("onNetwork", network) }
    }

    /// The network the phone is on now (familyfi `DeviceNetwork`), for the session's route order.
    Function("network") { () -> [String: String] in
      DeviceNetwork.shared.current
    }

    AsyncFunction("request") { (options: TransportRequest, promise: Promise) in
      guard let url = URL(string: options.url), url.scheme == "https" else {
        promise.reject("E_TRANSPORT", "Not an HTTPS URL.")
        return
      }
      if options.trustMode == "pinned" && (options.pin ?? "").isEmpty {
        promise.reject("E_TRANSPORT", "A pinned route has no pin.")
        return
      }
      var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: options.timeoutMs / 1000)
      request.httpMethod = options.method
      for (name, value) in options.headers { request.setValue(value, forHTTPHeaderField: name) }
      if let body = options.body { request.httpBody = Data(body.utf8) }

      let session = RouteSessions.shared.session(pin: options.trustMode == "pinned" ? options.pin : nil)
      let task = session.dataTask(with: request) { data, response, error in
        guard let http = response as? HTTPURLResponse, error == nil else {
          promise.reject("E_TRANSPORT", error?.localizedDescription ?? "No response.")
          return
        }
        var headers: [String: String] = [:]
        for (name, value) in http.allHeaderFields {
          if let name = name as? String { headers[name] = "\(value)" }
        }
        promise.resolve([
          "status": http.statusCode,
          "headers": headers,
          "body": data.flatMap { String(data: $0, encoding: .utf8) } ?? "",
        ])
      }
      if let connectMs = options.connectTimeoutMs, connectMs > 0, connectMs < options.timeoutMs {
        RouteSessions.shared.limitConnect(task, in: session, to: connectMs / 1000)
      }
      task.resume()
    }

    Function("spkiPin") { (certificateBase64: String) throws -> String in
      guard let der = Data(base64Encoded: certificateBase64),
            let certificate = SecCertificateCreateWithData(nil, der as CFData) else {
        throw TransportException("Not a DER certificate.")
      }
      return try spkiSHA256(certificate)
    }
  }
}

struct TransportRequest: Record {
  @Field var url: String = ""
  @Field var method: String = "GET"
  @Field var headers: [String: String] = [:]
  @Field var body: String?
  @Field var trustMode: String = "system"
  @Field var pin: String?
  @Field var timeoutMs: Double = 15_000
  /// How long to wait for the connection itself (familyfi `LAN_CONNECT_TIMEOUT_MS`), when set.
  @Field var connectTimeoutMs: Double?
}

final class TransportException: GenericException<String> {
  override var reason: String { param }
}

/// The network the phone is on (familyfi `DeviceNetwork`), from `NWPathMonitor`: `wifi` for Wi-Fi or
/// wired, `cellular`, else `other` (a VPN's tunnel interface, or no network). A Wi-Fi network's `key`
/// is its IPv4 subnet, which needs no permission (its name would need location access), so the
/// route that answered at home is not the one tried first on another Wi-Fi.
private final class DeviceNetwork: @unchecked Sendable {
  static let shared = DeviceNetwork()

  private let monitor = NWPathMonitor()
  private let lock = NSLock()
  private var latest: [String: String] = ["kind": "other"]
  private var listener: (([String: String]) -> Void)?

  /// Told each change; read and written under the lock, since the monitor's queue calls it.
  var onChange: (([String: String]) -> Void)? {
    get {
      lock.lock()
      defer { lock.unlock() }
      return listener
    }
    set {
      lock.lock()
      listener = newValue
      lock.unlock()
    }
  }

  var current: [String: String] {
    lock.lock()
    defer { lock.unlock() }
    return latest
  }

  private init() {
    monitor.pathUpdateHandler = { [weak self] path in
      guard let self else { return }
      let next = Self.describe(path)
      self.lock.lock()
      let changed = next != self.latest
      self.latest = next
      let listener = self.listener
      self.lock.unlock()
      if changed { listener?(next) }
    }
    monitor.start(queue: DispatchQueue(label: "com.getfamilyfi.transport.network"))
  }

  private static func describe(_ path: NWPath) -> [String: String] {
    guard path.status == .satisfied else { return ["kind": "other"] }
    if path.usesInterfaceType(.other) { return ["kind": "other"] }
    if path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet) {
      let local = path.availableInterfaces.first { $0.type == .wifi || $0.type == .wiredEthernet }
      if let name = local?.name, let subnet = ipv4Subnet(of: name) { return ["kind": "wifi", "key": subnet] }
      return ["kind": "wifi"]
    }
    if path.usesInterfaceType(.cellular) { return ["kind": "cellular"] }
    return ["kind": "other"]
  }

  /// "198.51.100.0/24": the interface's IPv4 address masked by its netmask.
  private static func ipv4Subnet(of interface: String) -> String? {
    var list: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&list) == 0, let first = list else { return nil }
    defer { freeifaddrs(list) }
    for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
      let entry = pointer.pointee
      guard String(cString: entry.ifa_name) == interface,
            let address = entry.ifa_addr, address.pointee.sa_family == UInt8(AF_INET),
            let mask = entry.ifa_netmask else { continue }
      let ip = address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
      let bits = mask.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
      let network = ip & bits
      let prefix = bits.nonzeroBitCount
      return "\(network >> 24).\((network >> 16) & 0xff).\((network >> 8) & 0xff).\(network & 0xff)/\(prefix)"
    }
    return nil
  }
}

/// One `URLSession` per trust: the system's, and each pin. Sessions are never invalidated; a phone
/// holds a handful of routes, so a handful of sessions.
private final class RouteSessions: @unchecked Sendable {
  static let shared = RouteSessions()

  private let lock = NSLock()
  private var system: URLSession?
  private var pinned: [String: URLSession] = [:]
  /// When each session last connected to each host: a TLS handshake that passed, or an answer.
  private var lastConnected: [String: Date] = [:]
  /// Tasks still waiting for a connection, by session and host, then task identifier.
  private var connecting: [String: Set<Int>] = [:]

  /// A pooled connection answers with no handshake, so a host this session connected to this
  /// recently is trusted to still have one, and its requests are not cut short.
  private static let pooledFor: TimeInterval = 30

  private static func origin(_ task: URLSessionTask, _ session: URLSession) -> String {
    "\(ObjectIdentifier(session).hashValue)|\(task.originalRequest?.url?.host ?? "")|\(task.originalRequest?.url?.port ?? 443)"
  }

  /// Cancels `task` if no connection to its host is made (a TLS handshake that passed, its own or
  /// another task's, which HTTP/2 then shares) and it is not answered within `seconds`. URLSession has
  /// no connect timeout of its own (its timeout is per idle interval). Used only for a request that
  /// can move to another route, so a task cut short that was in fact on a slow pooled connection only
  /// fails over.
  func limitConnect(_ task: URLSessionTask, in session: URLSession, to seconds: TimeInterval) {
    let origin = Self.origin(task, session)
    let id = task.taskIdentifier
    lock.lock()
    let recent = lastConnected[origin].map { Date().timeIntervalSince($0) < Self.pooledFor } ?? false
    if !recent { connecting[origin, default: []].insert(id) }
    lock.unlock()
    guard !recent else { return }
    DispatchQueue.global().asyncAfter(deadline: .now() + seconds) { [weak task] in
      self.lock.lock()
      let waiting = self.connecting[origin]?.remove(id) != nil
      self.lock.unlock()
      if waiting { task?.cancel() }
    }
  }

  /// A connection to the task's host is made (a handshake passed) or the task was answered: every
  /// task waiting on that host is connected too.
  func connected(_ task: URLSessionTask, in session: URLSession) {
    let origin = Self.origin(task, session)
    lock.lock()
    connecting[origin] = nil
    lastConnected[origin] = Date()
    lock.unlock()
  }

  func session(pin: String?) -> URLSession {
    lock.lock()
    defer { lock.unlock() }
    if let pin {
      if let session = pinned[pin] { return session }
      let session = Self.make(pin: pin)
      pinned[pin] = session
      return session
    }
    if let system { return system }
    let session = Self.make(pin: nil)
    system = session
    return session
  }

  private static func make(pin: String?) -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    return URLSession(configuration: configuration, delegate: RouteDelegate(pin: pin), delegateQueue: nil)
  }
}

/// Holds a pinned route to its pin, and returns redirects instead of following them.
private final class RouteDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  let pin: String?

  init(pin: String?) {
    self.pin = pin
  }

  /// Task-level, so a handshake is known per task (`RouteSessions.limitConnect`); URLSession sends a
  /// server-trust challenge here when the delegate has no session-level handler.
  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    guard let pin else {
      RouteSessions.shared.connected(task, in: session)
      completionHandler(.performDefaultHandling, nil)
      return
    }
    guard let trust = challenge.protectionSpace.serverTrust,
          let certificate = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first,
          let actual = try? spkiSHA256(certificate),
          actual == pin else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    RouteSessions.shared.connected(task, in: session)
    completionHandler(.useCredential, URLCredential(trust: trust))
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
    if task.response != nil { RouteSessions.shared.connected(task, in: session) }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}

// Copied from familyfi-ios e4f7928, Core/Networking/PinnedTrustDelegate.swift.

/// Produces the RFC 5280 SubjectPublicKeyInfo form, rather than hashing a whole certificate.
/// `SecKeyCopyExternalRepresentation` returns PKCS#1 for RSA and ANSI X9.63 for EC; those are
/// wrapped in their standard SPKI AlgorithmIdentifier. The result is unpadded base64url of a single
/// SHA-256 over the SPKI DER, which is what the server validates an operator-supplied pin against.
func spkiSHA256(_ certificate: SecCertificate) throws -> String {
  guard let key = SecCertificateCopyKey(certificate),
        let raw = SecKeyCopyExternalRepresentation(key, nil) as Data?,
        let attributes = SecKeyCopyAttributes(key) as? [CFString: Any],
        let keyType = attributes[kSecAttrKeyType] as? String else {
    throw TransportException("The certificate has no exportable public key.")
  }
  let spki: Data
  if keyType == (kSecAttrKeyTypeRSA as String) {
    spki = derSequence(derSequence(derOID([1, 2, 840, 113549, 1, 1, 1]) + Data([0x05, 0x00])) + derBitString(raw))
  } else if keyType == (kSecAttrKeyTypeECSECPrimeRandom as String),
            let bits = attributes[kSecAttrKeySizeInBits] as? Int,
            let curveOID = ecCurveOID(bits) {
    spki = derSequence(derSequence(derOID([1, 2, 840, 10045, 2, 1]) + derOID(curveOID)) + derBitString(raw))
  } else {
    throw TransportException("The certificate uses an unsupported public-key type.")
  }
  return Data(SHA256.hash(data: spki)).base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

private func ecCurveOID(_ bits: Int) -> [Int]? {
  switch bits {
  case 256: [1, 2, 840, 10045, 3, 1, 7]
  case 384: [1, 3, 132, 0, 34]
  case 521: [1, 3, 132, 0, 35]
  default: nil
  }
}

private func derSequence(_ contents: Data) -> Data { der(tag: 0x30, contents: contents) }
private func derBitString(_ contents: Data) -> Data { der(tag: 0x03, contents: Data([0]) + contents) }

private func derOID(_ values: [Int]) -> Data {
  precondition(values.count >= 2)
  var body = Data([UInt8(values[0] * 40 + values[1])])
  for value in values.dropFirst(2) {
    var encoded = [UInt8(value & 0x7f)]
    var remaining = value >> 7
    while remaining > 0 {
      encoded.insert(UInt8(remaining & 0x7f) | 0x80, at: 0)
      remaining >>= 7
    }
    body.append(contentsOf: encoded)
  }
  return der(tag: 0x06, contents: body)
}

private func der(tag: UInt8, contents: Data) -> Data {
  var output = Data([tag])
  if contents.count < 128 {
    output.append(UInt8(contents.count))
  } else {
    let bytes = withUnsafeBytes(of: UInt32(contents.count).bigEndian, Array.init).drop { $0 == 0 }
    output.append(0x80 | UInt8(bytes.count))
    output.append(contentsOf: bytes)
  }
  output.append(contentsOf: contents)
  return output
}
