/**
 * Who is talking, and what it may do: two separate things every invite and paired device holds.
 *
 * - The **client type** says which client it is: `app` (the FamilyFi app on a phone, tablet or Mac),
 *   `app-watch` (its Watch), `app-controls` (its Siri, Shortcuts and system controls, which run
 *   outside the app), `me` (FamilyFi Me on a child's phone), `me-watch` (FamilyFi Me's own Watch, set
 *   up by that phone and signed in for the same person) or `agent`.
 * - The **scope** is one value, `group:scope`: `app:full`, `app:rulesOnly`, `agent:full`,
 *   `agent:readOnly` or `me:askOnly`. It names one allowlist in `src/server/device-scope.ts`.
 *
 * The invite sets both, the claim copies them onto the device, and every signed-in call reads them
 * from the session's device. Each client type holds only the scopes `CLIENT_SCOPES` lists. The API
 * names them the same way: `clientType`, and `scope` as its whole value.
 */

export const CLIENT_TYPES = ["app", "app-watch", "app-controls", "me", "me-watch", "agent"] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const CLIENT_SCOPE_VALUES = ["app:full", "app:rulesOnly", "agent:full", "agent:readOnly", "me:askOnly"] as const;
export type ClientScope = (typeof CLIENT_SCOPE_VALUES)[number];

/** The scopes each client type may hold. Its first is the one it pairs with unless the invite names another. */
export const CLIENT_SCOPES: Record<ClientType, readonly ClientScope[]> = {
  app: ["app:full"],
  "app-watch": ["app:rulesOnly"],
  "app-controls": ["app:rulesOnly"],
  me: ["me:askOnly"],
  "me-watch": ["me:askOnly"],
  agent: ["agent:full", "agent:readOnly"],
};

export function isClientType(value: unknown): value is ClientType {
  return typeof value === "string" && (CLIENT_TYPES as readonly string[]).includes(value);
}

export function isClientScope(value: unknown): value is ClientScope {
  return typeof value === "string" && (CLIENT_SCOPE_VALUES as readonly string[]).includes(value);
}

/** Whether a client type may hold a scope. */
export function mayHoldScope(clientType: string, scope: string | null | undefined): boolean {
  return isClientType(clientType) && Boolean(scope) && CLIENT_SCOPES[clientType].includes(scope as ClientScope);
}

/**
 * Whether a client type signs in for a person (a family group) rather than as an account: FamilyFi Me
 * on a child's phone (`me`) and its Watch (`me-watch`).
 */
export function signsInForPerson(clientType: string | null | undefined): boolean {
  return clientType === "me" || clientType === "me-watch";
}

/** Whether a device signs in for a person (`signsInForPerson`). */
export function isPersonDevice<T extends { clientType: string }>(device: T | null | undefined): device is T {
  return Boolean(device) && signsInForPerson(device!.clientType);
}
