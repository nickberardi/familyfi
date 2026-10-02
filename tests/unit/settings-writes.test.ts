import { describe, expect, it } from "vitest";
import type { HouseholdStore } from "@/lib/household-store";
import { addFamilyMember, createLogin, removeLogin, saveTimezone, setAdmin, setFamilyRole } from "@/lib/settings-writes";
import { reconcileNow } from "@/lib/sync-writes";

/** A store's mutate that records what each write sends. */
function recorder() {
  const sent: { path: string; init?: { method?: string; body?: unknown } }[] = [];
  const mutate = (async (run: (send: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>) => Promise<unknown>) => {
    await run(async (path, init) => {
      sent.push({ path, init });
      return {};
    });
    return {};
  }) as unknown as HouseholdStore["mutate"];
  return { sent, mutate };
}

describe("settings writes", () => {
  it("sends each household change to its route", async () => {
    const { sent, mutate } = recorder();
    await saveTimezone(mutate, "Europe/London");
    await setFamilyRole(mutate, { id: "g1" }, "teen");
    await setAdmin(mutate, { id: "a1", isAdmin: false }, true);
    await removeLogin(mutate, { id: "a1" });
    await addFamilyMember(mutate, "A child");
    await createLogin(mutate, { id: "g2", name: "An adult" }, "  adult  ", "longenough");
    await reconcileNow(mutate);
    expect(sent).toEqual([
      { path: "/api/v1/settings/household", init: { method: "PUT", body: { timezone: "Europe/London" } } },
      { path: "/api/v1/groups/g1", init: { method: "PUT", body: { familyRole: "teen" } } },
      { path: "/api/v1/accounts/a1", init: { method: "PUT", body: { isAdmin: true } } },
      { path: "/api/v1/accounts/a1", init: { method: "DELETE" } },
      { path: "/api/v1/groups", init: { method: "POST", body: { kind: "family", name: "A child", familyRole: "child" } } },
      {
        path: "/api/v1/accounts",
        init: { method: "POST", body: { username: "adult", displayName: "An adult", password: "longenough", groupId: "g2", isAdmin: true } },
      },
      { path: "/api/v1/sync/retry", init: { method: "POST", body: {} } },
    ]);
  });
});
