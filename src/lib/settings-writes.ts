import type { HouseholdStore } from "./household-store";
import type { Account, Group } from "./types";

/**
 * Settings' household writes, as every client sends them. Changing the UniFi connection or key
 * is web-only and not here: the native app never sends a UniFi key.
 */

type Mutate = HouseholdStore["mutate"];

export function saveTimezone(mutate: Mutate, timezone: string) {
  return mutate((send) => send("/api/v1/settings/household", { method: "PUT", body: { timezone } }));
}

export function setFamilyRole(mutate: Mutate, group: Pick<Group, "id">, familyRole: NonNullable<Group["familyRole"]>) {
  return mutate((send) => send(`/api/v1/groups/${group.id}`, { method: "PUT", body: { familyRole } }));
}

export function setAdmin(mutate: Mutate, account: Pick<Account, "id" | "isAdmin">, isAdmin: boolean) {
  return mutate((send) => send(`/api/v1/accounts/${account.id}`, { method: "PUT", body: { isAdmin } }));
}

export function removeLogin(mutate: Mutate, account: Pick<Account, "id">) {
  return mutate((send) => send(`/api/v1/accounts/${account.id}`, { method: "DELETE" }));
}

/** A new family member starts as a child, as Settings' add row makes them. */
export function addFamilyMember(mutate: Mutate, name: string) {
  return mutate((send) => send("/api/v1/groups", { method: "POST", body: { kind: "family", name, familyRole: "child" } }));
}

/** A personal login for an adult, made an admin, as Settings creates it. */
export function createLogin(mutate: Mutate, group: Pick<Group, "id" | "name">, username: string, password: string) {
  return mutate((send) =>
    send("/api/v1/accounts", { method: "POST", body: { username: username.trim(), displayName: group.name, password, groupId: group.id, isAdmin: true } }),
  );
}
