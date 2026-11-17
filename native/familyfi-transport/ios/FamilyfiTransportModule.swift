import CryptoKit
import ExpoModulesCore
import Foundation
import Security

/// HTTPS to one household route. A pinned route trusts only a leaf certificate whose SPKI SHA-256
/// equals the pin: no system evaluation, no hostname check, and an empty pin fails. A system route
/// uses URLSession's normal trust. Redirects are returned, never followed, so a Cloudflare Access
/// sign-in redirect reaches JavaScript as a 3xx. Any failure without a response rejects.
public class FamilyfiTransportModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FamilyfiTransport")

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

      let configuration = URLSessionConfiguration.ephemeral
      configuration.httpCookieStorage = nil
      configuration.urlCache = nil
      let delegate = RouteDelegate(pin: options.trustMode == "pinned" ? options.pin : nil)
      let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
      session.dataTask(with: request) { data, response, error in
        defer { session.finishTasksAndInvalidate() }
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
      }.resume()
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
}

final class TransportException: GenericException<String> {
  override var reason: String { param }
}

/// Holds a pinned route to its pin, and returns redirects instead of following them.
private final class RouteDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  let pin: String?

  init(pin: String?) {
    self.pin = pin
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    guard let pin else {
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
    completionHandler(.useCredential, URLCredential(trust: trust))
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
