import Foundation
import Security

// A companion's session and where it is kept: what the phone hands over, the session made from it once
// its manifest verifies, the store the client (FFDeviceClient.swift) reads and renews it through, and
// the Keychain behind it. Each app keeps its own store: a Watch in its own Keychain, the FamilyFi app's
// Siri and Shortcuts actions where the app and its extensions can all reach it.

/// What the phone sends (familyfi `WatchProvisioning` in `src/lib/watch.ts`).
/// The routes come only from `manifest`, which the household's key must have signed.
struct FFWatchProvisioning: Codable, Sendable {
    struct Trust: Codable, Sendable { var instanceId: String; var publicKeyX: String }
    struct Manifest: Codable, Sendable { var signedPayload: String; var signature: String }
    var watchId: String
    var deviceId: String
    var token: String
    var expiresAt: String
    var refreshToken: String
    var refreshExpiresAt: String
    var trust: Trust
    var manifest: Manifest
}

/// The device's signed-in session, renewed in place as its bearer is.
struct FFWatchSession: Codable, Equatable, Sendable {
    var deviceId: String
    var token: String
    var expiresAt: String
    var refreshToken: String
    var trust: FFTrustProfile
    var edgeCredentials: [FFEndpointCredential]
    var lastAnswered: String?
}

extension FFWatchProvisioning {
    /// The session a provisioning gives, only when it is for the device with this id, complete, and
    /// its manifest is signed by the household's key and lists a route. Anything else is refused.
    func session(for id: String) throws -> FFWatchSession {
        guard watchId.lowercased() == id.lowercased(),
              !deviceId.isEmpty, !token.isEmpty, !refreshToken.isEmpty,
              !trust.instanceId.isEmpty, !trust.publicKeyX.isEmpty else { throw FFTrustError.invalid }
        let verified = try FFTrust.verifyManifest(
            signedPayload: manifest.signedPayload, signature: manifest.signature,
            publicKeyX: trust.publicKeyX, instanceId: trust.instanceId
        )
        guard verified.endpoints.contains(where: { $0.enabled }) else { throw FFTrustError.invalid }
        return FFWatchSession(
            deviceId: deviceId, token: token, expiresAt: expiresAt, refreshToken: refreshToken,
            trust: FFTrustProfile(instanceId: trust.instanceId, publicKeyX: trust.publicKeyX, endpoints: verified.endpoints),
            edgeCredentials: verified.edgeCredentials, lastAnswered: nil
        )
    }
}

/// Where a client keeps its session. `lockRenewal` is for a session more than one process holds: the
/// holder renews, and the others wait and then use what it saved.
protocol FFSessionStore: Sendable {
    var session: FFWatchSession? { get }
    func saveSession(_ session: FFWatchSession)
    /// Signed out: the household ended this session.
    func clear()
    func lockRenewal() async -> FFRenewalLock?
}

extension FFSessionStore {
    /// One process holds the session, so there is nothing to wait for.
    func lockRenewal() async -> FFRenewalLock? { nil }
}

/// An exclusive lock on a file, held until `unlock`: one renewal at a time across the processes that
/// share a session, so a refresh token is never spent twice.
final class FFRenewalLock: @unchecked Sendable {
    private let descriptor: Int32

    private init(descriptor: Int32) { self.descriptor = descriptor }

    /// Waits for the lock without blocking a thread. Nil when the file cannot be opened or the lock
    /// is still held after `timeout`: the caller then renews anyway, which the server tolerates once
    /// (the refresh token just replaced still answers).
    static func acquire(_ file: URL, timeout: TimeInterval = 20) async -> FFRenewalLock? {
        let descriptor = open(file.path, O_CREAT | O_RDWR, 0o600)
        guard descriptor >= 0 else { return nil }
        let deadline = Date().addingTimeInterval(timeout)
        while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            guard Date() < deadline, (try? await Task.sleep(nanoseconds: 50_000_000)) != nil else {
                close(descriptor)
                return nil
            }
        }
        return FFRenewalLock(descriptor: descriptor)
    }

    func unlock() {
        flock(descriptor, LOCK_UN)
        close(descriptor)
    }
}

/// Generic passwords under one service, readable after the first unlock so a background refresh can
/// read them. `accessGroup` shares them between an app and its extensions (an App Group's id).
struct FFKeychain: Sendable {
    let service: String
    var accessGroup: String?

    init(service: String, accessGroup: String? = nil) {
        self.service = service
        self.accessGroup = accessGroup
    }

    func read(_ account: String) -> Data? {
        var query = base(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    func write(_ account: String, _ data: Data) {
        var query = base(account)
        if SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess {
            SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        } else {
            query[kSecValueData as String] = data
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(query as CFDictionary, nil)
        }
    }

    func delete(_ account: String) {
        SecItemDelete(base(account) as CFDictionary)
    }

    private func base(_ account: String) -> [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }
}
