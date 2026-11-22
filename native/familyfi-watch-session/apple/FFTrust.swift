import CryptoKit
import Foundation
import Security

// How a paired watch trusts its household, as the phone does (familyfi `src/lib/companion-trust.ts`):
// the routes come only from a manifest the household's Ed25519 key signed, a pinned route trusts only
// its pinned key, and an Access credential goes only to its own route. Adapted from familyfi-ios
// `Core/Networking` at a1814cc (ConnectionEndpoint, PinnedTrustDelegate, EdgeCredential).

enum FFTrustMode: String, Codable, Sendable { case system, pinned }

struct FFRoute: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var url: String
    var transport: String
    var trustMode: FFTrustMode
    var spkiSha256: String?
    var priority: Int
    var enabled: Bool
    var edgeAuth: String?
    var edgeTokenVersion: Int?
}

struct FFEndpointCredential: Codable, Equatable, Sendable, CustomStringConvertible {
    var endpointId: String
    var version: Int
    var clientId: String
    var clientSecret: String

    var description: String { "Access credential (redacted)" }
}

struct FFTrustProfile: Codable, Equatable, Sendable {
    var instanceId: String
    var publicKeyX: String
    var endpoints: [FFRoute]
}

enum FFTrustError: Error, LocalizedError {
    case signature, wrongHousehold, invalid

    var errorDescription: String? {
        switch self {
        case .signature: "FamilyFi's connection details are not signed by this household."
        case .wrongHousehold: "FamilyFi's connection details are for another household."
        case .invalid: "FamilyFi returned invalid connection details."
        }
    }
}

enum FFTrust {
    /// Routes tried in order: enabled ones, the one that last answered first.
    static func candidates(_ routes: [FFRoute], lastAnswered: String?) -> [FFRoute] {
        let enabled = routes.filter(\.enabled)
        return enabled.filter { $0.id == lastAnswered } + enabled.filter { $0.id != lastAnswered }
    }

    /// `verifyManifest`: the signed payload, checked against the household's key, names this household.
    static func verifyManifest(signedPayload: String, signature: String, publicKeyX: String, instanceId: String) throws -> (endpoints: [FFRoute], edgeCredentials: [FFEndpointCredential]) {
        guard let payload = base64URLData(signedPayload), let signatureData = base64URLData(signature),
              let keyData = base64URLData(publicKeyX),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData),
              key.isValidSignature(signatureData, for: payload) else { throw FFTrustError.signature }
        struct Body: Decodable { var instanceId: String; var endpoints: [FFRoute]; var edgeCredentials: [FFEndpointCredential]? }
        guard let body = try? JSONDecoder().decode(Body.self, from: payload) else { throw FFTrustError.signature }
        guard body.instanceId == instanceId else { throw FFTrustError.wrongHousehold }
        let credentials = body.edgeCredentials ?? []
        try validate(endpoints: body.endpoints, credentials: credentials)
        return (body.endpoints, credentials)
    }

    /// `validateManifest`: HTTPS origins, a pin on every pinned route, unique ids, and each route's Access binding.
    static func validate(endpoints: [FFRoute], credentials: [FFEndpointCredential]) throws {
        guard Set(endpoints.map(\.id)).count == endpoints.count,
              Set(credentials.map(\.endpointId)).count == credentials.count else { throw FFTrustError.invalid }
        for endpoint in endpoints {
            guard isServerOrigin(endpoint.url) else { throw FFTrustError.invalid }
            if endpoint.trustMode == .pinned {
                guard let pin = endpoint.spkiSha256, isPin(pin) else { throw FFTrustError.invalid }
            }
            let credential = credentials.first { $0.endpointId == endpoint.id }
            if endpoint.edgeAuth == "serviceToken" {
                guard endpoint.transport == "cloudflare", endpoint.trustMode == .system, let credential,
                      credential.version > 0, credential.version == endpoint.edgeTokenVersion,
                      headerSafe(credential.clientId), headerSafe(credential.clientSecret) else { throw FFTrustError.invalid }
            } else if credential != nil || endpoint.edgeTokenVersion != nil {
                throw FFTrustError.invalid
            }
        }
        guard credentials.allSatisfy({ credential in endpoints.contains { $0.id == credential.endpointId } }) else { throw FFTrustError.invalid }
    }

    /// `edgeHeaders`: a route's Access credential, only on that route and only at its version.
    static func edgeHeaders(_ route: FFRoute, credentials: [FFEndpointCredential]) -> [String: String] {
        guard route.edgeAuth == "serviceToken",
              let credential = credentials.first(where: { $0.endpointId == route.id && $0.version == route.edgeTokenVersion }) else { return [:] }
        return ["CF-Access-Client-Id": credential.clientId, "CF-Access-Client-Secret": credential.clientSecret]
    }

    /// `isEdgeUnavailable`: Cloudflare Access answered, not FamilyFi. The route is unavailable: try the next.
    static func isEdgeUnavailable(status: Int, location: String?, body: Data) -> Bool {
        if (300..<400).contains(status) {
            return location.flatMap { URL(string: $0)?.host?.hasSuffix(".cloudflareaccess.com") } ?? false
        }
        guard status == 401 || status == 403 else { return false }
        struct Wire: Decodable { struct E: Decodable { var code: String; var message: String }; var error: E }
        return (try? JSONDecoder().decode(Wire.self, from: body)) == nil
    }

    /// How long a refresh waits on one route before trying the next (familyfi `companion-request.ts`
    /// `REFRESH_TIMEOUT_MS`). A server from 1.1.0 honours the token a refresh just replaced until the
    /// new pair is used; older ones only within a 10 s grace, which two routes' attempts fit, so a
    /// reply lost on one route can still be retried on the next.
    static let refreshTimeout: TimeInterval = 5
    /// Every other request's wait per route.
    static let requestTimeout: TimeInterval = 15

    /// The household refused a call outside the device's scope: 403 `watch_scope` for a Watch
    /// (`app-watch`, `app:rulesOnly`), 403 `app_scope` for the app's Siri, Shortcuts and controls
    /// (`app:rulesOnly`). Only that: the session stays, so this never renews or signs the device out.
    static func isScopeRefusal(status: Int, body: Data) -> Bool {
        guard status == 403 else { return false }
        struct Wire: Decodable { struct E: Decodable { var code: String }; var error: E }
        let code = (try? JSONDecoder().decode(Wire.self, from: body))?.error.code
        return code == "watch_scope" || code == "app_scope" || code == "me_scope"
    }

    /// The server refused a refresh token itself (familyfi `companion-session.ts` `refused`): only this
    /// signs the Watch out. A server that fails to answer (5xx, 429) leaves the session to try again.
    static func refusesRefresh(status: Int) -> Bool { status == 400 || status == 401 || status == 403 }

    /// A pinned route's TLS decision: trusted only when the leaf certificate's SubjectPublicKeyInfo
    /// hashes to the pin. No leaf, an unreadable key or another key fails closed.
    static func trusts(leaf: SecCertificate?, pin: String) -> Bool {
        guard let leaf, let hash = spkiSHA256(leaf) else { return false }
        return hash == pin
    }

    static func isServerOrigin(_ value: String) -> Bool {
        guard let url = URL(string: value), url.scheme == "https", let host = url.host, !host.isEmpty,
              url.path.isEmpty || url.path == "/", url.query == nil, url.fragment == nil, url.user == nil else { return false }
        return true
    }

    /// A pin is 43 base64url characters: `/^[A-Za-z0-9_-]{43}$/`.
    private static func isPin(_ value: String) -> Bool {
        value.utf8.count == 43 && value.utf8.allSatisfy { (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }
    }

    private static func headerSafe(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 512 && value.utf8.allSatisfy { $0 >= 33 && $0 <= 126 }
    }
}

func base64URLData(_ value: String) -> Data? {
    var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    return Data(base64Encoded: base64)
}

func sha256Base64URL(_ data: Data) -> String {
    Data(SHA256.hash(data: data)).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

/// The base64url SHA-256 of a certificate's SubjectPublicKeyInfo, as the server's pins are written.
func spkiSHA256(_ certificate: SecCertificate) -> String? {
    guard let key = SecCertificateCopyKey(certificate),
          let raw = SecKeyCopyExternalRepresentation(key, nil) as Data?,
          let attributes = SecKeyCopyAttributes(key) as? [CFString: Any],
          let keyType = attributes[kSecAttrKeyType] as? String else { return nil }
    let spki: Data
    if keyType == (kSecAttrKeyTypeRSA as String) {
        spki = DER.sequence(DER.sequence(DER.oid([1, 2, 840, 113_549, 1, 1, 1]) + Data([0x05, 0x00])) + DER.bitString(raw))
    } else if keyType == (kSecAttrKeyTypeECSECPrimeRandom as String), let bits = attributes[kSecAttrKeySizeInBits] as? Int, let curve = DER.curve(bits) {
        spki = DER.sequence(DER.sequence(DER.oid([1, 2, 840, 10045, 2, 1]) + DER.oid(curve)) + DER.bitString(raw))
    } else {
        return nil
    }
    return sha256Base64URL(spki)
}

private enum DER {
    static func curve(_ bits: Int) -> [Int]? {
        switch bits {
        case 256: [1, 2, 840, 10045, 3, 1, 7]
        case 384: [1, 3, 132, 0, 34]
        case 521: [1, 3, 132, 0, 35]
        default: nil
        }
    }

    static func sequence(_ contents: Data) -> Data { element(0x30, contents) }
    static func bitString(_ contents: Data) -> Data { element(0x03, Data([0]) + contents) }

    static func oid(_ values: [Int]) -> Data {
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
        return element(0x06, body)
    }

    static func element(_ tag: UInt8, _ contents: Data) -> Data {
        var output = Data([tag])
        if contents.count < 128 {
            output.append(UInt8(contents.count))
        } else {
            let bytes = withUnsafeBytes(of: UInt32(contents.count).bigEndian, Array.init).drop { $0 == 0 }
            output.append(0x80 | UInt8(bytes.count))
            output.append(contentsOf: bytes)
        }
        output.append(contents)
        return output
    }
}
