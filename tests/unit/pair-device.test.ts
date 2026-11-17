import { describe, expect, it } from "vitest";
import {
  APP_STORES,
  CHILD_PHONES_COPY,
  PAIR_COPY,
  PLAY_BETA,
  canRepair,
  childPhoneName,
  childPhonesOf,
  defaultPairingAccount,
  inviteChildPhone,
  invitePhone,
  isApp,
  isAppControls,
  pairingAccounts,
  pairingChildGroups,
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
import type { Account, ConnectionRoute, Group, PairedPhone } from "@/lib/types";

const phone = (over: Partial<PairedPhone> = {}): PairedPhone => ({
  id: "p1",
  displayName: "A phone",
  clientType: "app",
  scope: "app:full",
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
    expect(revokeConfirm(phone())).toMatchObject({ title: "Revoke A phone?", message: "It is signed out now and must be paired again. Its shortcuts and system controls, and any Watch, phone or agent it paired, stop working too." });
    expect(revokeConfirm(phone({ clientType: "app-watch", displayName: "A Watch" }))).toMatchObject({ title: "Revoke A Watch?", message: "It is signed out now and must be paired again." });
    expect(removeConfirm(phone())).toMatchObject({ title: "Remove A phone from the list?", message: "This can't be undone; setup would be needed again." });
    expect(removeAllConfirm(3)).toMatchObject({ title: "Remove all 3 revoked devices from the list?", message: "This can't be undone." });
    expect(showAllLabel(12)).toBe("Show all 12 devices");
    expect(revokedToggleLabel(false, 2)).toBe("Show revoked (2)");
    expect(revokedToggleLabel(true, 2)).toBe("Hide revoked (2)");
  });

  it("describes every device the same way: access, how it reaches home, and its dates", () => {
    const now = new Date("2026-09-14T20:00:00Z");
    const session = (id: string, expiresAt: string) => ({ id, username: "admin", expiresAt, createdAt: "2026-09-14T12:00:00Z" });
    const lines = phoneLines(phone({ actsAs: { username: "admin", displayName: "An adult" }, sessions: [session("s2", "2026-12-14T12:00:00Z"), session("s1", "2026-10-14T12:00:00Z")] }), now);
    expect(lines.tags.map((tag) => tag.label)).toEqual(["Full access", "An adult"]);
    expect(lines.tags[1].name).toBe("Acts as An adult");
    expect(lines.access).toBe("Last seen 2m ago");
    expect(lines.via).toEqual({ url: "https://home.example", transport: "My domain" });
    // The sign-in that ends first is the one that matters.
    expect(lines.dates).toMatch(/^Paired .+ · expires Oct 1[45], 2026$/);
    expect(lines.expired).toBe(false);
    expect(phoneLines(phone({ lastSeenAt: null }), now).access).toBe("Last seen never");
    const revoked = phoneLines(phone({ revokedAt: "2026-09-10T00:00:00Z" }), now);
    expect(revoked.access).toMatch(/^Revoked /);
    expect(revoked.expired).toBe(false);
    expect(phoneLines(phone(), now)).toMatchObject({ dates: expect.not.stringContaining("expires"), expired: true });
    // An expired phone is re-paired in place; Watches and agents, which have no Re-pair, pair again.
    expect(PAIR_COPY.expired).toBe("Expired. Re-pair it to sign it in again.");
    expect(PAIR_COPY.expiredPairAgain).toBe("Expired. Revoke it and pair again.");
    expect(phoneLines(phone({ pairedVia: null }), now).origin).toBe("via a route that was removed");
  });

  it("tags an app with whether it gets alerts", () => {
    const now = new Date("2026-09-14T20:00:00Z");
    const labels = (alerts: boolean | undefined, revokedAt: string | null = null) => phoneLines(phone({ alerts, revokedAt }), now).tags.map((tag) => tag.label);
    expect(labels(true)).toEqual(["Full access", "An adult", "Alerts on"]);
    expect(labels(false)).toEqual(["Full access", "An adult", "Alerts off"]);
    // Watches, Siri's sign-in and agents have no alerts field, and a revoked phone says nothing of them.
    expect(labels(undefined)).toEqual(["Full access", "An adult"]);
    expect(labels(true, "2026-09-10T00:00:00Z")).toEqual(["Full access", "An adult"]);
    // Alerts on are green and off yellow; full access green, rules only blue, read only red; the adult grey.
    const tones = (over: Partial<PairedPhone>) => phoneLines(phone(over), now).tags.map((tag) => tag.tone);
    expect(tones({ alerts: true })).toEqual(["green", "neutral", "green"]);
    expect(tones({ alerts: false })).toEqual(["green", "neutral", "yellow"]);
    expect(tones({ scope: "app:rulesOnly" })[0]).toBe("blue");
    expect(tones({ scope: "agent:readOnly" })[0]).toBe("red");
  });

  it("offers Re-pair on any phone, active or revoked, but not the one showing the list", () => {
    expect(canRepair(phone(), { canPair: true })).toBe(true);
    expect(canRepair(phone({ revokedAt: "2026-09-10T00:00:00Z" }), { canPair: true })).toBe(true);
    expect(canRepair(phone(), { canPair: true, selfId: phone().id })).toBe(false);
    expect(canRepair(phone(), { canPair: true, selfId: "another-phone" })).toBe(true);
    expect(canRepair(phone(), { canPair: false })).toBe(false);
    expect(canRepair(phone({ clientType: "app-watch" }), { canPair: true })).toBe(false);
    expect(canRepair(phone({ clientType: "agent" }), { canPair: true })).toBe(false);
    // An app's own Siri and shortcuts sign-in is the app client too, and is never re-paired.
    expect(canRepair(phone({ clientType: "app-controls", scope: "app:rulesOnly" }), { canPair: true })).toBe(false);
  });

  it("tells an app from its Siri and shortcuts by client type", () => {
    expect(isApp(phone())).toBe(true);
    expect(isApp(phone({ clientType: "app-controls", scope: "app:rulesOnly" }))).toBe(false);
    expect(isApp(phone({ clientType: "app-watch", scope: "app:rulesOnly" }))).toBe(false);
    expect(isAppControls(phone({ clientType: "app-controls", scope: "app:rulesOnly" }))).toBe(true);
    expect(isAppControls(phone())).toBe(false);
    expect(isAppControls(phone({ clientType: "app-watch", scope: "app:rulesOnly" }))).toBe(false);
    expect(revokeConfirm(phone({ clientType: "app-controls", scope: "app:rulesOnly", displayName: "Siri and Shortcuts on A phone" }))).toMatchObject({
      title: "Revoke Siri and Shortcuts on A phone?",
      message: "They stop working now, until you next open FamilyFi on that device. The app itself stays paired.",
    });
    expect(removeConfirm(phone({ clientType: "app-controls", scope: "app:rulesOnly" })).message).toBe("This can't be undone.");
  });

  it("invites a phone as the app", async () => {
    const sent: unknown[] = [];
    const server = (async (path: string, init: { body: unknown }) => {
      sent.push([path, init.body]);
      return { invite: { id: "i" } };
    }) as never;
    await invitePhone(server, { endpointId: "r1", displayName: "iPhone" });
    expect(sent).toEqual([["/api/v1/paired/invites", { clientType: "app", endpointId: "r1", displayName: "iPhone" }]]);
  });

  it("titles each step of the pairing sheet", () => {
    expect(pairingSheetCopy().name.title).toBe("Pair a device");
    expect(pairingSheetCopy({ replacing: { displayName: "Old phone" } }).name.title).toBe("Re-pair Old phone");
    expect(pairingSheetCopy({ replacing: { displayName: "Old phone" } }).name.sub).toBe(
      "Makes a new single-use code for this device. Its old pairing keeps working until the code is used, then is signed out and removed, and its Watch moves to the new pairing.",
    );
    expect(pairingSheetCopy().code.title).toBe("Scan with the FamilyFi app");
    expect(pairingSheetCopy().name.sub).toBe("Makes a single-use code that pairs one device and signs it in as the adult you choose. It expires in five minutes.");
    expect(pairingSheetCopy({ claimed: true, claimedName: "New phone" }).code).toEqual({ title: "Device paired", sub: "New phone is paired and signed in." });
    expect(pairingSheetCopy({ claimed: true, replacing: { displayName: "Old" } }).code.sub).toBe("The device is paired and signed in; its old entry is gone.");
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
    expect(phoneLines(phone({ actsAs: null })).tags.map((tag) => tag.label)).toEqual(["Full access"]);
    const agent = phone({ clientType: "agent", scope: "agent:readOnly", pairedVia: null, actsAs: { username: "admin", displayName: "An adult" } });
    expect(phoneLines(agent).tags.map((tag) => tag.label)).toEqual(["Read only", "An adult"]);
    expect(phoneLines(agent).origin).toBe("On the home network");
    const watch = phone({ clientType: "app-watch", scope: "app:rulesOnly", pairedVia: null });
    expect(phoneLines(watch).origin).toBe("Paired automatically from an iPhone");
    expect(phoneLines(watch, new Date(), "Kitchen iPhone").origin).toBe("Paired automatically from Kitchen iPhone");
  });

  it("names the phone a phone or agent was paired from, which revoking takes it with", () => {
    const paired = phone({ clientType: "agent", scope: "agent:readOnly", pairedVia: null });
    expect(phoneLines(paired, new Date(), "Kitchen iPhone").dates).toMatch(/^Paired .+ from Kitchen iPhone/);
    expect(phoneLines(paired).dates).not.toContain(" from ");
    const watch = phone({ clientType: "app-watch", scope: "app:rulesOnly", pairedVia: null });
    expect(phoneLines(watch, new Date(), "Kitchen iPhone").dates).not.toContain(" from ");
    const controls = phone({ clientType: "app-controls", scope: "app:rulesOnly", pairedVia: null });
    expect(phoneLines(controls, new Date(), "Kitchen iPhone").origin).toBe("Set up automatically by Kitchen iPhone");
    expect(phoneLines(controls).origin).toBe("Set up automatically by the FamilyFi app");
    expect(phoneLines(controls, new Date(), "Kitchen iPhone").dates).not.toContain(" from ");
  });

  it("offers a phone only personal administrators to sign in as, the one signed in here first", () => {
    const account = (over: Partial<Account>): Account => ({
      id: "a1", username: "admin", displayName: "An adult", kind: "personal", isAdmin: true, groupId: null, recovery: false, ...over,
    });
    const accounts = [
      account({ id: "member", username: "member", isAdmin: false }),
      account({ id: "recovery", username: "recovery", kind: "recovery", isAdmin: false, recovery: true }),
      account({ id: "admin", username: "admin" }),
    ];
    // No device acts as the recovery admin, even when it is the one signed in here.
    expect(pairingAccounts(accounts).map((each) => each.id)).toEqual(["admin"]);
    expect(defaultPairingAccount(accounts, "admin")).toBe("admin");
    expect(defaultPairingAccount(accounts, "member")).toBe("admin");
    expect(defaultPairingAccount(accounts, "recovery")).toBe("admin");
    expect(defaultPairingAccount([], "admin")).toBe("");
  });
});

describe("FamilyFi Me on a child's phone", () => {
  const child = (over: Partial<PairedPhone> = {}) =>
    phone({ id: "m1", displayName: "Emma's phone", clientType: "me", scope: "me:askOnly", actsAs: null, group: { id: "g1", name: "Emma" }, ...over });

  it("is tagged for its family member, never as an account", () => {
    const { tags } = phoneLines(child(), new Date("2026-09-15T12:00:00Z"));
    expect(tags).toEqual([
      { label: "FamilyFi Me", name: "FamilyFi Me", tone: "neutral" },
      { label: "Emma", name: "For Emma", tone: "neutral" },
    ]);
  });

  it("lists a family member's own phones that are still paired", () => {
    const phones = [child(), child({ id: "m2", revokedAt: "2026-09-10T12:00:00Z" }), child({ id: "m3", group: { id: "g2", name: "Max" } }), phone()];
    expect(childPhonesOf(phones, "g1").map((item) => item.id)).toEqual(["m1"]);
  });

  it("is paired for a family member, named for them until someone renames it", () => {
    const groups = [{ id: "g1", kind: "family", name: "Emma" }, { id: "t1", kind: "things", name: "TV" }] as Group[];
    expect(pairingChildGroups(groups).map((group) => group.id)).toEqual(["g1"]);
    expect(childPhoneName({ name: "Emma" })).toBe("Emma's phone");
    expect(childPhoneName(undefined)).toBe("Phone");
  });

  it("says what the code is for at each step", () => {
    const copy = pairingSheetCopy({ child: true });
    expect(copy.name.title).toBe(PAIR_COPY.pairMe);
    expect(copy.code.title).toBe("Scan with FamilyFi Me");
    expect(copy.phone).toBe("Phone name");
    expect(pairingSheetCopy({ child: true, claimed: true, claimedName: "Emma's phone" }).code).toEqual({ title: "Phone paired", sub: "Emma's phone is paired and signed in." });
    expect(CHILD_PHONES_COPY.empty("Emma")).toBe("Pair FamilyFi Me on Emma's phone so they can see their rules and ask you for more time.");
  });

  it("invites with its family group and no account", async () => {
    const sent: { path: string; init?: { method?: string; body?: unknown } }[] = [];
    const request = (async (path: string, init?: { method?: string; body?: unknown }) => {
      sent.push({ path, init });
      return {};
    }) as never;
    await inviteChildPhone(request, { endpointId: "r1", displayName: "Emma's phone", groupId: "g1" });
    expect(sent).toEqual([{ path: "/api/v1/paired/invites", init: { method: "POST", body: { clientType: "me", endpointId: "r1", displayName: "Emma's phone", groupId: "g1" } } }]);
  });
});
