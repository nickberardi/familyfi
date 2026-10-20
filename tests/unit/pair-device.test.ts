import { describe, expect, it } from "vitest";
import {
  APP_STORES,
  PAIR_COPY,
  PLAY_BETA,
  canRepair,
  confirmLine,
  defaultPairingAccount,
  pairingAccounts,
  pairingExpired,
  pairingSheetCopy,
  phoneLines,
  publishedRoute,
  removeAllConfirm,
  removeConfirm,
  removePhone,
  removeRevokedPhones,
  revokeConfirm,
  revokePhone,
  revokedToggleLabel,
  showAllLabel,
  splitPhones,
} from "@/lib/pair-device";
import type { Account, ConnectionRoute, PairedPhone } from "@/lib/types";

const phone = (over: Partial<PairedPhone> = {}): PairedPhone => ({
  id: "p1",
  displayName: "A phone",
  client: "phone",
  scope: "full",
  actsAs: { username: "admin", displayName: "An adult" },
  parentDeviceId: null,
  enrolledAt: "2026-09-01T12:00:00Z",
  lastSeenAt: "2026-09-14T19:58:00Z",
  revokedAt: null,
  pairedVia: { endpointId: "r1", url: "https://home.example", transport: "lan" },
  edgeTokens: [],
  sessions: [],
  ...over,
});

describe("pair device", () => {
  it("shows both store badges, linking only to a store that has a link", () => {
    expect(APP_STORES.map((store) => store.label)).toEqual(["Download on the App Store", "Get it on Google Play"]);
    expect(APP_STORES.every((store) => store.url === null || store.url.startsWith("https://"))).toBe(true);
  });

  it("opens Google Play's closed beta steps, each linked over HTTPS", () => {
    expect(APP_STORES.filter((store) => "steps" in store && store.steps).map((store) => store.id)).toEqual(["google"]);
    expect(PLAY_BETA.steps.map((step) => step.text)).toEqual(["Sign in to the Google account you use on your Android phone", "Join the beta group", "Become a tester", "Install FamilyFi from Google Play"]);
    expect(PLAY_BETA.steps.every((step) => step.url.startsWith("https://"))).toBe(true);
  });

  it("splits active phones from revoked ones, keeping the API's order", () => {
    const { active, revoked } = splitPhones([phone({ id: "a" }), phone({ id: "b", revokedAt: "2026-09-10T00:00:00Z" }), phone({ id: "c" })]);
    expect(active.map((item) => item.id)).toEqual(["a", "c"]);
    expect(revoked.map((item) => item.id)).toEqual(["b"]);
  });

  it("pairs only through the published, enabled route", () => {
    const routes = [{ id: "r1", enabled: true }, { id: "r2", enabled: false }] as ConnectionRoute[];
    expect(publishedRoute({ endpointId: "r1" }, routes)?.id).toBe("r1");
    expect(publishedRoute({ endpointId: "r2" }, routes)).toBeNull();
    expect(publishedRoute(null, routes)).toBeNull();
    expect(publishedRoute({ endpointId: "r1" }, null)).toBeNull();
  });

  it("asks before revoking or removing, in the web's words", () => {
    expect(confirmLine(revokeConfirm(phone()))).toBe("Revoke A phone? It is signed out now and must be paired again. The Watches it set up stop working too.");
    expect(confirmLine(revokeConfirm(phone({ client: "watch", displayName: "A Watch" })))).toBe("Revoke A Watch? It is signed out now and must be paired again.");
    expect(confirmLine(removeConfirm(phone()))).toBe("Remove A phone from the list? This can't be undone; setup would be needed again.");
    expect(confirmLine(removeAllConfirm(3))).toBe("Remove all 3 revoked devices from the list? This can't be undone.");
    expect(showAllLabel(12)).toBe("Show all 12 devices");
    expect(revokedToggleLabel(false, 2)).toBe("Show revoked (2)");
    expect(revokedToggleLabel(true, 2)).toBe("Hide revoked (2)");
  });

  it("describes every device the same way: access, how it reaches home, and its dates", () => {
    const now = new Date("2026-09-14T20:00:00Z");
    const session = (id: string, expiresAt: string) => ({ id, username: "admin", client: "phone" as const, expiresAt, createdAt: "2026-09-14T12:00:00Z" });
    const lines = phoneLines(phone({ actsAs: { username: "admin", displayName: "An adult" }, sessions: [session("s2", "2026-12-14T12:00:00Z"), session("s1", "2026-10-14T12:00:00Z")] }), now);
    expect(lines.access).toBe("Full access · acts as An adult · last seen 2m ago");
    expect(lines.via).toEqual({ url: "https://home.example", transport: "My domain" });
    // The sign-in that ends first is the one that matters.
    expect(lines.dates).toMatch(/^Paired .+ · expires Oct 1[45], 2026$/);
    expect(lines.expired).toBe(false);
    expect(phoneLines(phone({ lastSeenAt: null }), now).access).toMatch(/last seen never$/);
    const revoked = phoneLines(phone({ revokedAt: "2026-09-10T00:00:00Z" }), now);
    expect(revoked.access).toMatch(/ · revoked /);
    expect(revoked.expired).toBe(false);
    expect(phoneLines(phone(), now)).toMatchObject({ dates: expect.not.stringContaining("expires"), expired: true });
    // An expired phone is re-paired in place; Watches and agents, which have no Re-pair, pair again.
    expect(PAIR_COPY.expired).toBe("Expired. Re-pair it to sign it in again.");
    expect(PAIR_COPY.expiredPairAgain).toBe("Expired. Revoke it and pair again.");
    expect(phoneLines(phone({ pairedVia: null }), now).origin).toBe("via a route that was removed");
  });

  it("offers Re-pair on any phone, active or revoked, but not the one showing the list", () => {
    expect(canRepair(phone(), { canPair: true })).toBe(true);
    expect(canRepair(phone({ revokedAt: "2026-09-10T00:00:00Z" }), { canPair: true })).toBe(true);
    expect(canRepair(phone(), { canPair: true, selfId: phone().id })).toBe(false);
    expect(canRepair(phone(), { canPair: true, selfId: "another-phone" })).toBe(true);
    expect(canRepair(phone(), { canPair: false })).toBe(false);
    expect(canRepair(phone({ client: "watch" }), { canPair: true })).toBe(false);
    expect(canRepair(phone({ client: "agent" }), { canPair: true })).toBe(false);
  });

  it("titles each step of the pairing sheet", () => {
    expect(pairingSheetCopy().name.title).toBe("Pair a phone");
    expect(pairingSheetCopy({ replacing: { displayName: "Old phone" } }).name.title).toBe("Re-pair Old phone");
    expect(pairingSheetCopy({ replacing: { displayName: "Old phone" } }).name.sub).toBe(
      "Makes a new single-use code for this phone. Its old pairing keeps working until the code is used, then is signed out and removed, and its Watch moves to the new pairing.",
    );
    expect(pairingSheetCopy().code.title).toBe("Scan with the FamilyFi app");
    expect(pairingSheetCopy().name.sub).toBe("Makes a single-use code that pairs one phone and signs it in as the adult you choose. It expires in five minutes.");
    expect(pairingSheetCopy({ claimed: true, claimedName: "New phone" }).code).toEqual({ title: "Phone paired", sub: "New phone is paired and signed in." });
    expect(pairingSheetCopy({ claimed: true, replacing: { displayName: "Old" } }).code.sub).toBe("The phone is paired and signed in; its old entry is gone.");
  });

  it("speaks of any phone, not only an iPhone, since the app runs on Android too", () => {
    expect(PAIR_COPY.sub).not.toContain("iPhone");
    expect(pairingSheetCopy().defaultName).not.toContain("iPhone");
  });

  it("expires a code at its time, or when the server says so", () => {
    const issued = { expiresAt: "2026-09-14T20:05:00Z" };
    const at = (iso: string) => new Date(iso).getTime();
    expect(pairingExpired(null, null, at("2026-09-14T20:00:00Z"))).toBe(false);
    expect(pairingExpired(issued, null, at("2026-09-14T20:00:00Z"))).toBe(false);
    expect(pairingExpired(issued, null, at("2026-09-14T20:05:00Z"))).toBe(true);
    expect(pairingExpired(issued, { status: "expired" }, at("2026-09-14T20:00:00Z"))).toBe(true);
  });

  it("revokes and removes phones at their routes", async () => {
    const sent: { path: string; init?: { method?: string } }[] = [];
    const send = async <T,>(path: string, init?: { method?: string }) => {
      sent.push({ path, init });
      return {} as T;
    };
    await revokePhone(send, { id: "p1" });
    await removePhone(send, { id: "p1" });
    await removeRevokedPhones(send);
    expect(sent).toEqual([
      { path: "/api/v1/paired/devices/p1", init: { method: "DELETE" } },
      { path: "/api/v1/paired/devices/p1?remove=true", init: { method: "DELETE" } },
      { path: "/api/v1/paired/devices?status=revoked", init: { method: "DELETE" } },
    ]);
  });

  it("names a device's scope, the adult it acts as, and where it came from", () => {
    expect(phoneLines(phone({ actsAs: null })).access).toMatch(/^Full access · last seen /);
    const agent = phone({ client: "agent", scope: "readOnly", pairedVia: null, actsAs: { username: "admin", displayName: "An adult" } });
    expect(phoneLines(agent).access).toMatch(/^Read only · acts as An adult · /);
    expect(phoneLines(agent).origin).toBe("On the home network");
    const watch = phone({ client: "watch", scope: "rulesOnly", pairedVia: null });
    expect(phoneLines(watch).origin).toBe("Paired automatically from an iPhone");
    expect(phoneLines(watch, new Date(), "Kitchen iPhone").origin).toBe("Paired automatically from Kitchen iPhone");
  });

  it("offers a phone only administrators to sign in as, the one signed in here first", () => {
    const account = (over: Partial<Account>): Account => ({
      id: "a1", username: "admin", displayName: "An adult", kind: "personal", isAdmin: true, groupId: null, recovery: false, ...over,
    });
    const accounts = [
      account({ id: "member", username: "member", isAdmin: false }),
      account({ id: "recovery", username: "recovery", kind: "recovery", isAdmin: false, recovery: true }),
      account({ id: "admin", username: "admin" }),
    ];
    expect(pairingAccounts(accounts).map((each) => each.id)).toEqual(["recovery", "admin"]);
    expect(defaultPairingAccount(accounts, "admin")).toBe("admin");
    expect(defaultPairingAccount(accounts, "member")).toBe("recovery");
    expect(defaultPairingAccount([], "admin")).toBe("");
  });
});
