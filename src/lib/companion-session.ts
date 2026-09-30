import { ApiError, type ApiRequest } from "./api-client";
import type { EndpointCredential } from "./companion-trust";
import {
  claimHousehold,
  refreshRoutes,
  signInPaired,
  verifyHousehold,
  type ConnectionProfile,
  type PendingEnrollment,
  type StoredSession,
} from "./companion-pairing";
import { createCompanionRequest, type Transport } from "./companion-request";
import { SIGN_IN_UNREACHABLE, signInError } from "./sign-in";

/**
 * A paired phone's session: what it keeps between launches, and the steps that change it. Plain
 * TypeScript, so a native client wraps it in its own provider, as the web wraps the household store.
 * Nothing is kept until it verified: the profile is written only after the household's identity and
 * signed manifest checked out.
 */

/** The platform's secure storage (the Keychain or Keystore). */
export type SecureStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

const PROFILE = "connectionProfile";
const EDGE = "edgeCredentials";
const SESSION = "bearerSession";

export type SessionVault = ReturnType<typeof createSessionVault>;

export function createSessionVault(storage: SecureStorage) {
  const read = async <T>(key: string): Promise<T | null> => {
    const value = await storage.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      // Unreadable: treat as absent, so the phone pairs or signs in again rather than half-trusting.
      await storage.delete(key);
      return null;
    }
  };
  return {
    profile: () => read<ConnectionProfile>(PROFILE),
    edgeCredentials: async () => (await read<EndpointCredential[]>(EDGE)) ?? [],
    session: () => read<StoredSession>(SESSION),
    async savePairing(profile: ConnectionProfile, edgeCredentials: EndpointCredential[]) {
      await storage.set(PROFILE, JSON.stringify(profile));
      await storage.set(EDGE, JSON.stringify(edgeCredentials));
      await storage.delete(SESSION);
    },
    async saveRoutes(profile: ConnectionProfile, edgeCredentials: EndpointCredential[]) {
      await storage.set(PROFILE, JSON.stringify(profile));
      await storage.set(EDGE, JSON.stringify(edgeCredentials));
    },
    saveSession: (session: StoredSession) => storage.set(SESSION, JSON.stringify(session)),
    /** Signing out ends the session and keeps the pairing, so the next sign-in needs no new code. */
    signOut: () => storage.delete(SESSION),
    /** Forgetting the household removes everything; the phone must pair again. */
    async forget() {
      await Promise.all([storage.delete(SESSION), storage.delete(EDGE), storage.delete(PROFILE)]);
    },
  };
}

/** Where a launch lands: pairing, sign-in once paired, or the household once signed in. */
export type SessionStatus = "loading" | "unpaired" | "signedOut" | "signedIn";

export type CompanionSessionState = {
  status: SessionStatus;
  profile: ConnectionProfile | null;
  session: StoredSession | null;
  /** A household that verified and awaits the person's decision; it holds the unspent code, so it is never stored. */
  pending: PendingEnrollment | null;
  /** The route that last answered. */
  activeRouteId: string | null;
};

export type CompanionSession = ReturnType<typeof createCompanionSession>;

export function createCompanionSession(deps: { transport: Transport; storage: SecureStorage; deviceName: () => string }) {
  const { transport, deviceName } = deps;
  const vault = createSessionVault(deps.storage);
  let state: CompanionSessionState = { status: "loading", profile: null, session: null, pending: null, activeRouteId: null };
  let credentials: EndpointCredential[] = [];
  const listeners = new Set<() => void>();
  const set = (patch: Partial<CompanionSessionState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  /** Requests for the signed-in household, over its trusted routes, read at the moment they are sent. */
  const request: ApiRequest = createCompanionRequest(transport, {
    routes: () => state.profile?.endpoints ?? [],
    edgeCredentials: () => credentials,
    token: () => state.session?.token ?? null,
    activeRouteId: () => state.activeRouteId,
    onRoute: (route) => {
      if (state.activeRouteId !== route.id) set({ activeRouteId: route.id });
    },
  });

  /** Still paired with the household `asked` was for: not forgotten, nor replaced by another pairing. */
  const holds = (asked: ConnectionProfile) =>
    state.profile?.instanceId === asked.instanceId && state.profile.deviceId === asked.deviceId;
  /** Ends a session on the server in the background, with the routes and credentials it was made over. */
  const endOnServer = (profile: ConnectionProfile, edge: EndpointCredential[], token: string) =>
    void createCompanionRequest(transport, { routes: () => profile.endpoints, edgeCredentials: () => edge, token: () => token })(
      "/api/v1/auth/logout",
      { method: "POST" },
    ).catch(() => undefined);

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request,
    /** Reads what the phone kept, and lands the launch. Storage that cannot be read (a lost key) lands on setup, where pairing again replaces it. */
    async load() {
      let stored;
      try {
        stored = await Promise.all([vault.profile(), vault.session(), vault.edgeCredentials()]);
      } catch {
        credentials = [];
        set({ profile: null, session: null, status: "unpaired" });
        return;
      }
      const [profile, session, edge] = stored;
      credentials = edge;
      set({ profile, session: profile ? session : null, status: !profile ? "unpaired" : session ? "signedIn" : "signedOut" });
    },
    /** Reads a pairing code and verifies the household it names. Throws; `pairingErrorMessage` words it. */
    async verify(code: string) {
      set({ pending: await verifyHousehold(transport, code) });
    },
    /** The explicit trust action: spends the code, and keeps the household only if its manifest verifies. */
    async trust() {
      if (!state.pending) return;
      const claimed = await claimHousehold(transport, state.pending, deviceName());
      await vault.savePairing(claimed.profile, claimed.edgeCredentials);
      credentials = claimed.edgeCredentials;
      set({ pending: null, profile: claimed.profile, session: null, status: "signedOut" });
    },
    /** "Not my household — start over": drops the unspent code. */
    reject: () => set({ pending: null }),
    /** For the shared sign-in form: resolves to an error to show, or null. */
    async signIn(username: string, password: string): Promise<string | null> {
      const asked = state.profile;
      if (!asked) return SIGN_IN_UNREACHABLE;
      try {
        const edge = credentials;
        const session = await signInPaired(request, asked, username, password);
        // Forgotten or re-paired while signing in: the session is for a household the phone no longer holds.
        if (!holds(asked)) {
          endOnServer(asked, edge, session.token);
          return null;
        }
        await vault.saveSession(session);
        if (!holds(asked)) {
          await vault.signOut();
          endOnServer(asked, edge, session.token);
          return null;
        }
        set({ session, status: "signedIn" });
        return null;
      } catch (error) {
        return error instanceof ApiError ? signInError({ ok: false, body: { error: { message: error.message } } }) : SIGN_IN_UNREACHABLE;
      }
    },
    /** Signs out on the phone at once, and ends the session on the server in the background when it can be reached. */
    async signOut() {
      const { profile, session } = state;
      await vault.signOut();
      set({ session: null, status: profile ? "signedOut" : "unpaired" });
      if (profile && session) endOnServer(profile, credentials, session.token);
    },
    /** Forgets the household at once, so the phone must pair again; its session ends on the server in the background. */
    async forget() {
      const { profile, session } = state;
      const edge = credentials;
      await vault.forget();
      credentials = [];
      set({ profile: null, session: null, pending: null, activeRouteId: null, status: "unpaired" });
      if (profile && session) endOnServer(profile, edge, session.token);
    },
    /** Re-reads the routes, keeping them only from a manifest the trusted key signed. */
    async refresh() {
      const asked = state.profile;
      if (!asked) return;
      const next = await refreshRoutes(request, asked, credentials);
      // Forgotten or re-paired while it was asked: the answer is for a household the phone no longer holds.
      if (!holds(asked)) return;
      // Run on every household refresh: unchanged routes are neither saved again nor announced.
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      if (same(next.profile, state.profile) && same(next.edgeCredentials, credentials)) return;
      await vault.saveRoutes(next.profile, next.edgeCredentials);
      if (!holds(asked)) {
        // Forgotten or re-paired while it was saved: put back what the phone holds now.
        await (state.profile ? vault.saveRoutes(state.profile, credentials) : vault.forget());
        return;
      }
      credentials = next.edgeCredentials;
      set({ profile: next.profile });
    },
  };
}
