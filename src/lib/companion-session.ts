import { ApiError, type ApiRequest } from "./api-client";
import type { EndpointCredential } from "./companion-trust";
import {
  claimHousehold,
  refreshRoutes,
  renewPaired,
  verifyHousehold,
  type ConnectionProfile,
  type PendingEnrollment,
  type StoredSession,
} from "./companion-pairing";
import { createCompanionRequest, type Transport } from "./companion-request";

/**
 * A paired phone's session: what it keeps between launches, and the steps that change it. Plain
 * TypeScript, so a native client wraps it in its own provider, as the web wraps the household store.
 * Nothing is kept until it verified: the profile is written only after the household's identity and
 * signed manifest checked out. Pairing is the sign-in: a paired phone is signed in, and a phone whose
 * session ends is no longer paired, so it pairs again with a new code.
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
      // Unreadable: treat as absent, so the phone pairs again rather than half-trusting.
      await storage.delete(key);
      return null;
    }
  };
  return {
    profile: () => read<ConnectionProfile>(PROFILE),
    edgeCredentials: async () => (await read<EndpointCredential[]>(EDGE)) ?? [],
    session: () => read<StoredSession>(SESSION),
    async savePairing(profile: ConnectionProfile, edgeCredentials: EndpointCredential[], session: StoredSession) {
      await storage.set(PROFILE, JSON.stringify(profile));
      await storage.set(EDGE, JSON.stringify(edgeCredentials));
      await storage.set(SESSION, JSON.stringify(session));
    },
    async saveRoutes(profile: ConnectionProfile, edgeCredentials: EndpointCredential[]) {
      await storage.set(PROFILE, JSON.stringify(profile));
      await storage.set(EDGE, JSON.stringify(edgeCredentials));
    },
    saveSession: (session: StoredSession) => storage.set(SESSION, JSON.stringify(session)),
    /** Forgetting the household removes everything; the phone must pair again. */
    async forget() {
      await Promise.all([storage.delete(SESSION), storage.delete(EDGE), storage.delete(PROFILE)]);
    },
  };
}

/** Where a launch lands: pairing, or the household once paired (pairing signs the phone in). */
export type SessionStatus = "loading" | "unpaired" | "signedIn";

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

  const connection = {
    routes: () => state.profile?.endpoints ?? [],
    edgeCredentials: () => credentials,
    activeRouteId: () => state.activeRouteId,
    onRoute: (route: { id: string }) => {
      if (state.activeRouteId !== route.id) set({ activeRouteId: route.id });
    },
  };
  /** One request over the trusted routes with the bearer held at the moment it is sent. */
  const send: ApiRequest = createCompanionRequest(transport, { ...connection, token: () => state.session?.token ?? null });
  /** The refresh call carries no bearer: its refresh token is the credential. */
  const sendUnsigned: ApiRequest = createCompanionRequest(transport, { ...connection, token: () => null });

  let renewing: Promise<void> | null = null;
  /**
   * Trades the refresh token for a new bearer, one renewal at a time: requests that find the bearer
   * expiring together wait for the same one, so a refresh token is never spent twice. A refused
   * token (spent, reused, revoked or expired) means the household ended this phone's pairing, so the
   * phone forgets it and pairs again; a route that cannot be reached, or a server that fails to
   * answer (5xx, 429), leaves the session as it is, to try again.
   */
  function renew(): Promise<void> {
    renewing ??= (async () => {
      const asked = state.profile;
      const held = state.session;
      if (!asked || !held?.refreshToken) throw new ApiError("Signed out.", 401, "unauthorized");
      try {
        const next = await renewPaired(sendUnsigned, held.refreshToken);
        // Forgotten or paired again while it was asked: the answer is for a session the phone no longer holds.
        if (!holds(asked) || state.session !== held) return;
        // The server has already replaced the old refresh token: hold the new one even if storing it
        // fails, so this launch keeps working. The next launch then holds the replaced token, which
        // the server refuses after its grace, and pairs again.
        set({ session: next });
        await vault.saveSession(next).catch(() => undefined);
      } catch (error) {
        if (refused(error) && holds(asked) && state.session === held) {
          // Forgotten here first: a store that fails to forget must not leave the phone looking
          // paired with a refused token.
          await lose();
          throw new ApiError(error.message, 401, error.code);
        }
        throw error;
      }
    })().finally(() => {
      renewing = null;
    });
    return renewing;
  }

  /** The server refused the refresh token itself (400 malformed, 401, 403 spent, reused, revoked or expired). */
  const refused = (error: unknown): error is ApiError =>
    error instanceof ApiError && (error.status === 400 || error.status === 401 || error.status === 403);

  /** The bearer runs out within this, so it is renewed first rather than refused mid-request. */
  const RENEW_AHEAD_MS = 60_000;
  const expiring = () => {
    const expires = state.session ? Date.parse(state.session.session.expiresAt) : NaN;
    return Boolean(state.session?.refreshToken) && Number.isFinite(expires) && expires - Date.now() < RENEW_AHEAD_MS;
  };

  /**
   * Requests for the signed-in household, over its trusted routes. A bearer about to expire is
   * renewed first, and a request the server refuses as unauthenticated is renewed and sent once more
   * (it was refused before it could change anything). A renewal that cannot reach the server, or
   * that the server fails to answer, is left to the request. A request refused because another
   * renewal replaced its bearer meanwhile is sent again with the new one, without renewing again.
   */
  const request: ApiRequest = async <T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
    if (expiring()) await renew().catch((error: unknown) => {
      if (refused(error)) throw error;
    });
    const sentWith = state.session?.token ?? null;
    try {
      return await send<T>(path, init);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || !state.session?.refreshToken) throw error;
      if (state.session.token === sentWith) await renew();
      return send<T>(path, init);
    }
  };

  /** Still paired with the household `asked` was for: not forgotten, nor replaced by another pairing. */
  const holds = (asked: ConnectionProfile) =>
    state.profile?.instanceId === asked.instanceId && state.profile.deviceId === asked.deviceId;
  /** Revokes this phone on the server with the routes and session it held, renewing the bearer first if it has run out. */
  const revokeOnServer = async (profile: ConnectionProfile, edge: EndpointCredential[], held: StoredSession) => {
    const over = (token: string | null) =>
      createCompanionRequest(transport, { routes: () => profile.endpoints, edgeCredentials: () => edge, token: () => token });
    let token = held.token;
    if (held.refreshToken && Date.parse(held.session.expiresAt) - Date.now() < RENEW_AHEAD_MS) {
      token = (await renewPaired(over(null), held.refreshToken).catch(() => null))?.token ?? token;
    }
    await over(token)(`/api/v1/paired/devices/${encodeURIComponent(profile.deviceId)}`, { method: "DELETE" }).catch(() => undefined);
  };

  /**
   * The phone is no longer paired (unpaired, or the household ended its session): it forgets the
   * household at once and lands on setup. Storage that fails to forget does not keep it paired.
   */
  const lose = async () => {
    credentials = [];
    set({ profile: null, session: null, pending: null, activeRouteId: null, status: "unpaired" });
    await vault.forget().catch(() => undefined);
  };

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
      // A pairing without its session (one kept from before pairing signed in) is no pairing at all.
      if (!profile || !session) {
        await lose();
        return;
      }
      credentials = edge;
      set({ profile, session, status: "signedIn" });
    },
    /** Reads a pairing code and verifies the household it names. Throws; `pairingErrorMessage` words it. */
    async verify(code: string) {
      set({ pending: await verifyHousehold(transport, code) });
    },
    /**
     * The explicit trust action: spends the code, which signs the phone in, and keeps the household
     * only if its manifest verifies.
     */
    async trust() {
      if (!state.pending) return;
      const claimed = await claimHousehold(transport, state.pending, deviceName());
      await vault.savePairing(claimed.profile, claimed.edgeCredentials, claimed.session);
      credentials = claimed.edgeCredentials;
      set({ pending: null, profile: claimed.profile, session: claimed.session, status: "signedIn" });
    },
    /** "Not my household — start over": drops the unspent code. */
    reject: () => set({ pending: null }),
    /**
     * "Unpair this phone": forgets the household at once, so the phone pairs again with a new code,
     * and revokes it on the server in the background, which also revokes the Watches it set up. It
     * revokes with the session it held, renewed first when its bearer has run out; unreachable, the
     * household keeps the record until an administrator revokes it.
     */
    async unpair() {
      const { profile, session } = state;
      const edge = credentials;
      await lose();
      if (profile && session) void revokeOnServer(profile, edge, session);
    },
    /** The household ended this phone's session (it answers 401): the phone is no longer paired. */
    lost: () => lose(),
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
