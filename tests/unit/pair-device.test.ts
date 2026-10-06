import { describe, expect, it } from "vitest";
import {
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

  it("describes a phone's pairing, last use and sessions", () => {
    const now = new Date("2026-09-14T20:00:00Z");
    const lines = phoneLines(phone({ sessions: [{ id: "s1", username: "admin", client: "phone", expiresAt: "2026-10-14T12:00:00Z", createdAt: "2026-09-14T12:00:00Z" }] }), now);
    expect(lines.status).toMatch(/^Paired .+ · last seen 2m ago$/);
    expect(lines.via).toEqual({ url: "https://home.example", transport: "My domain" });
    expect(lines.sessions[0]!.line).toMatch(/^admin · expires /);
    expect(phoneLines(phone({ lastSeenAt: null }), now).status).toMatch(/last seen never$/);
    expect(phoneLines(phone({ revokedAt: "2026-09-10T00:00:00Z" }), now).status).toMatch(/ · revoked /);
    expect(phoneLines(phone({ pairedVia: null, client: "watch" }), now)).toMatchObject({ via: null, viaMissing: "Paired automatically from an iPhone" });
    expect(phoneLines(phone({ pairedVia: null }), now).viaMissing).toBe("via a route that was removed");
  });

  it("titles each step of the pairing sheet", () => {
    expect(pairingSheetCopy().name.title).toBe("Pair a phone");
    expect(pairingSheetCopy({ replacing: { displayName: "Old phone" } }).name.title).toBe("Re-pair Old phone");
    expect(pairingSheetCopy().code.title).toBe("Scan with the FamilyFi app");
    expect(pairingSheetCopy().name.sub).toBe("Makes a single-use code that pairs one phone and signs it in as the adult you choose. It expires in five minutes.");
    expect(pairingSheetCopy({ claimed: true, claimedName: "New phone" }).code).toEqual({ title: "Phone paired", sub: "New phone is paired and signed in." });
    expect(pairingSheetCopy({ claimed: true, replacing: { displayName: "Old" } }).code.sub).toBe("The phone is paired and signed in; its old entry is gone.");
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

  it("names a device's scope, and the adult an agent acts as", () => {
    expect(phoneLines(phone()).scope).toBe("Full access");
    const agent = phone({ client: "agent", scope: "readOnly", pairedVia: null, actsAs: { username: "admin", displayName: "An adult" } });
    expect(phoneLines(agent).scope).toBe("Read only");
    expect(phoneLines(agent).viaMissing).toBe("AI agent on the home network · acts as An adult");
    expect(phoneLines(phone({ client: "watch", scope: "rulesOnly", pairedVia: null })).viaMissing).toBe("Paired automatically from an iPhone");
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
