import Foundation

// The `/api/v1` client of a paired watch or another companion that holds its own session (familyfi
// `native/familyfi-watch-session`): its trusted routes, its own bearer, refresh. Shared by the
// FamilyFi app's Watch and FamilyFi Me's Watch, each of which adds the calls its scope allows in an
// extension. It mirrors the phone's (familyfi `companion-request.ts` and `companion-session.ts`):
// reads and the refresh fail over to the next route, a household write never does; a bearer about to
// expire is renewed first, and a refused one is renewed and the request sent once more; a refused
// refresh token signs the device out, while a server that fails to answer (5xx, 429) leaves the
// session to try again. A call outside its scope (403 `watch_scope`, `app_scope` or `me_scope`) is
// only that: it never renews or signs the device out. Only paths under /api/v1 are ever sent.

enum FFWatchAPIError: Error {
    /// No route answered.
    case unreachable
    /// The household no longer accepts this device's session: it must be set up again.
    case signedOut
    /// The device's scope does not allow the call; it stays signed in.
    case notAllowed
    case server(status: Int, message: String, code: String?)
}

/// ISO 8601 instants as JavaScript's `Date.toISOString()` writes them, read with or without fractions.
enum FFISO {
    private static let withFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let plain = Date.ISO8601FormatStyle()

    static func string(_ date: Date) -> String { date.formatted(withFraction) }
    static func date(_ value: String) -> Date? { (try? withFraction.parse(value)) ?? (try? plain.parse(value)) }
}

actor FFDeviceClient {
    private let store: any FFSessionStore
    private var renewing: Task<Void, Error>?

    init(store: any FFSessionStore) { self.store = store }

    /// `/health`'s answer, asked without the bearer (the server answers it to anyone), or nil when it
    /// could not be asked.
    func health(query: String = "") async -> [String: Any]? {
        guard let data = try? await attempt("/api/v1/health\(query)", method: "GET", body: nil, bearer: nil) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    /// A write under `/api/v1`, resolving to its answer's body.
    func post(_ path: String, body: [String: Any] = [:]) async throws -> Data {
        try await send(path, method: "POST", body: body)
    }

    /// A write under `/api/v1`, resolving to its change's id when it made one.
    func postChange(_ path: String, body: [String: Any] = [:]) async throws -> String? {
        let data = try await post(path, body: body)
        struct Answer: Decodable { struct Change: Decodable { var changeId: String }; var change: Change? }
        return (try? JSONDecoder().decode(Answer.self, from: data))?.change?.changeId
    }

    /// Re-reads the routes, keeping them only from a manifest this household's key signed.
    func refreshRoutes() async throws {
        let data = try await send("/api/v1/connection", method: "GET", body: nil)
        struct Answer: Decodable { struct Manifest: Decodable { var signedPayload: String; var signature: String }; var endpointManifest: Manifest }
        guard let answer = try? JSONDecoder().decode(Answer.self, from: data), var session = store.session else { throw FFTrustError.invalid }
        let verified = try FFTrust.verifyManifest(
            signedPayload: answer.endpointManifest.signedPayload, signature: answer.endpointManifest.signature,
            publicKeyX: session.trust.publicKeyX, instanceId: session.trust.instanceId
        )
        guard verified.endpoints != session.trust.endpoints || verified.edgeCredentials != session.edgeCredentials else { return }
        session.trust.endpoints = verified.endpoints
        session.edgeCredentials = verified.edgeCredentials
        store.saveSession(session)
    }

    func get<T: Decodable>(_ path: String, key: String) async throws -> T {
        let data = try await send(path, method: "GET", body: nil)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let value = object?[key] else { throw FFWatchAPIError.server(status: 200, message: "FamilyFi answered unexpectedly.", code: nil) }
        return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed))
    }

    /// Sends with the device's bearer, renewing it first when it is about to expire, and once more after a 401.
    func send(_ path: String, method: String, body: [String: Any]?) async throws -> Data {
        guard let session = store.session else { throw FFWatchAPIError.signedOut }
        if let expires = FFISO.date(session.expiresAt), expires.timeIntervalSinceNow < 60 {
            // Unreachable, or the server failed to answer: left to the request itself.
            do { try await renew(replacing: session.token) } catch FFWatchAPIError.unreachable {} catch FFWatchAPIError.server {}
        }
        let sentWith = store.session?.token
        do {
            return try await attempt(path, method: method, body: body, bearer: sentWith)
        } catch let FFWatchAPIError.server(status, _, _) where status == 401 {
            // Another request may have renewed meanwhile: then resend with its bearer, without renewing again.
            if let sentWith, store.session?.token == sentWith { try await renew(replacing: sentWith) }
            return try await attempt(path, method: method, body: body, bearer: store.session?.token)
        }
    }

    /// One renewal at a time, so a refresh token is never spent twice: one task in this process, and
    /// the store's lock across processes (the app and its widget extension share one session).
    private func renew(replacing token: String) async throws {
        if let renewing { return try await renewing.value }
        let task = Task { try await self.renewNow(replacing: token) }
        renewing = task
        defer { renewing = nil }
        try await task.value
    }

    private func renewNow(replacing token: String) async throws {
        let lock = await store.lockRenewal()
        defer { lock?.unlock() }
        // Another process renewed while this one waited for the lock: its bearer is the one to use.
        guard let held = store.session else { throw FFWatchAPIError.signedOut }
        guard held.token == token else { return }
        let data: Data
        do {
            data = try await attempt("/api/v1/auth/refresh", method: "POST", body: ["refreshToken": held.refreshToken], bearer: nil)
        } catch let FFWatchAPIError.server(status, _, _) where FFTrust.refusesRefresh(status: status) {
            // Spent, reused, revoked or expired: the household has ended this device's session.
            store.clear()
            throw FFWatchAPIError.signedOut
        }
        struct Answer: Decodable { struct Session: Decodable { var expiresAt: String }; var token: String; var refreshToken: String; var session: Session }
        guard let answer = try? JSONDecoder().decode(Answer.self, from: data), var current = store.session, current.refreshToken == held.refreshToken else { return }
        current.token = answer.token
        current.refreshToken = answer.refreshToken
        current.expiresAt = answer.session.expiresAt
        store.saveSession(current)
    }

    /// Tries each route in order. A read or a refresh that cannot reach a route, or meets an Access
    /// wall, moves on; a household write never does, since it may have landed.
    func attempt(_ path: String, method: String, body: [String: Any]?, bearer: String?) async throws -> Data {
        precondition(path.hasPrefix("/api/v1/"), "Only the household API")
        guard let session = store.session else { throw FFWatchAPIError.signedOut }
        let retryable = method == "GET" || path == "/api/v1/auth/refresh"
        for route in FFTrust.candidates(session.trust.endpoints, lastAnswered: session.lastAnswered) {
            guard let url = URL(string: route.url + path) else { continue }
            var request = URLRequest(url: url, timeoutInterval: path == "/api/v1/auth/refresh" ? FFTrust.refreshTimeout : FFTrust.requestTimeout)
            request.httpMethod = method
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            for (name, value) in FFTrust.edgeHeaders(route, credentials: session.edgeCredentials) { request.setValue(value, forHTTPHeaderField: name) }
            if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
            if let body {
                request.httpBody = try JSONSerialization.data(withJSONObject: body)
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
            // A pinned route with no pin fails closed.
            if route.trustMode == .pinned && route.spkiSha256 == nil { continue }
            let delegate = FFRouteDelegate(pin: route.trustMode == .pinned ? route.spkiSha256 : nil)
            let urlSession = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
            defer { urlSession.finishTasksAndInvalidate() }
            let data: Data
            let response: HTTPURLResponse
            do {
                let (body, answer) = try await urlSession.data(for: request)
                guard let http = answer as? HTTPURLResponse else { throw FFWatchAPIError.unreachable }
                (data, response) = (body, http)
            } catch {
                if retryable { continue }
                throw FFWatchAPIError.unreachable
            }
            if FFTrust.isEdgeUnavailable(status: response.statusCode, location: response.value(forHTTPHeaderField: "Location"), body: data) {
                if retryable { continue }
                throw FFWatchAPIError.unreachable
            }
            if var current = store.session, current.lastAnswered != route.id {
                current.lastAnswered = route.id
                store.saveSession(current)
            }
            guard (200..<300).contains(response.statusCode) else {
                if FFTrust.isScopeRefusal(status: response.statusCode, body: data) { throw FFWatchAPIError.notAllowed }
                struct Wire: Decodable { struct E: Decodable { var message: String; var code: String? }; var error: E }
                let wire = (try? JSONDecoder().decode(Wire.self, from: data))?.error
                let message = wire?.message
                // Every error FamilyFi sends says what went wrong. A server error without those words
                // came from something on the way (a tunnel or proxy), so FamilyFi was not reached.
                if message == nil && response.statusCode >= 500 { throw FFWatchAPIError.unreachable }
                throw FFWatchAPIError.server(status: response.statusCode, message: message ?? "FamilyFi refused the request.", code: wire?.code)
            }
            return data
        }
        throw FFWatchAPIError.unreachable
    }
}

/// One route's TLS: a pinned route trusts only the leaf whose SubjectPublicKeyInfo hashes to its pin,
/// and never falls back to system trust; a system route uses URLSession's own checks. Redirects are
/// never followed, so a Cloudflare Access sign-in reads as the route being unavailable.
final class FFRouteDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let pin: String?

    init(pin: String?) { self.pin = pin }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        guard let pin else { return (.performDefaultHandling, nil) }
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              FFTrust.trusts(leaf: (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first, pin: pin) else { return (.cancelAuthenticationChallenge, nil) }
        return (.useCredential, URLCredential(trust: trust))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest) async -> URLRequest? {
        nil
    }
}
