/**
 * Who is talking, and what it may do: two separate things every invite and paired device holds.
 *
 * - The **client type** says which client it is: `app` (the FamilyFi app on a phone, tablet or Mac),
 *   `app-watch` (its Watch), `app-controls` (its Siri, Shortcuts and system controls, which run
 *   outside the app), `me` (FamilyFi Me on a child's phone) or `agent`. `me-watch` is reserved.
 * - The **scope** is one value, `group:scope`: `app:full`, `app:rulesOnly`, `agent:full`,
 *   `agent:readOnly` or `me:askOnly`. It names one allowlist in `src/server/device-scope.ts`.
 *
 * The invite sets both, the claim copies them onto the device, and every signed-in call reads them
 * from the session's device. Each client type holds only the scopes `CLIENT_SCOPES` lists.
 *
 * The API's older `client` and `scope` fields stay as they were, for installed apps: `legacyClient`
 * and `scopeWord` give them, and `clientTypeFrom` reads an older request's words.
 */

export const CLIENT_TYPES = ["app", "app-watch", "app-controls", "me", "agent"] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const DEVICE_SCOPES = ["app:full", "app:rulesOnly", "agent:full", "agent:readOnly", "me:askOnly"] as const;
export type DeviceScope = (typeof DEVICE_SCOPES)[number];

/** The scopes each client type may hold. Its first is the one it pairs with unless the invite names another. */
export const CLIENT_SCOPES: Record<ClientType, readonly DeviceScope[]> = {
  app: ["app:full"],
  "app-watch": ["app:rulesOnly"],
  "app-controls": ["app:rulesOnly"],
  me: ["me:askOnly"],
  agent: ["agent:full", "agent:readOnly"],
};

export function isClientType(value: unknown): value is ClientType {
  return typeof value === "string" && (CLIENT_TYPES as readonly string[]).includes(value);
}

export function isDeviceScope(value: unknown): value is DeviceScope {
  return typeof value === "string" && (DEVICE_SCOPES as readonly string[]).includes(value);
}

/** Whether a client type may hold a scope. */
export function mayHoldScope(clientType: string, scope: string | null | undefined): boolean {
  return isClientType(clientType) && Boolean(scope) && CLIENT_SCOPES[clientType].includes(scope as DeviceScope);
}

/** The API's older `client` word: `watch` for a Watch, `app` for the app and its controls. */
export function legacyClient(clientType: string): string {
  if (clientType === "app-watch") return "watch";
  if (clientType === "app-controls") return "app";
  return clientType;
}

/** The API's older `scope` word: the part after the group, such as `full` for `app:full`. */
export function scopeWord(scope: string): string {
  const colon = scope.indexOf(":");
  return colon < 0 ? scope : scope.slice(colon + 1);
}

/** The full scope a client type holds for an older request's scope word, or null when it may not hold it. */
export function scopeFor(clientType: ClientType, word: string): DeviceScope | null {
  return CLIENT_SCOPES[clientType].find((scope) => scopeWord(scope) === word) ?? null;
}

/**
 * The client type an older request names with `client` and `scope`: `watch` is `app-watch`, `app`
 * with `rulesOnly` is `app-controls`, and `phone` (apps before API 1.1.0) is `app`.
 */
export function clientTypeFrom(client: string, scope?: string | null): ClientType | null {
  if (client === "watch") return "app-watch";
  if (client === "app" || client === "phone") return scope === "rulesOnly" ? "app-controls" : "app";
  return isClientType(client) ? client : null;
}
