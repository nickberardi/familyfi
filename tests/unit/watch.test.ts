import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MANIFEST_SIGNATURE_INVALID } from "@/lib/companion-trust";
import type { PairedPhone } from "@/lib/types";
import {
  WATCH_MAX_GROUPS,
  enrollWatch,
  keepWatches,
  listWatches,
  orderedWatchGroups,
  reconcileWatchSelection,
  reconcileWatches,
  removeWatch,
  watchGroupIds,
  watchIdForDevice,
  watchProvisioning,
  withWatch,
  type WatchEnrollment,
} from "@/lib/watch";

const groups = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => ({ id }));

/** A household key and a manifest it signs, as the server signs one (`signedEndpointManifest`). */
function household() {
  const keys = generateKeyPairSync("ed25519");
  const x = (keys.publicKey.export({ format: "jwk" }) as { x: string }).x;
  const manifest = (signer = keys) => {
    const bytes = Buffer.from(JSON.stringify({ instanceId: "ff_1", endpoints: [], edgeCredentials: [] }));
    return { signedPayload: bytes.toString("base64url"), signature: sign(null, bytes, signer.privateKey).toString("base64url") };
  };
  return { x, manifest };
}

const enrollment = (manifest: WatchEnrollment["connection"]["manifest"]): WatchEnrollment => ({
  device: { id: "w", displayName: "Apple Watch" },
  session: { username: "admin", displayName: "An adult", kind: "recovery", expiresAt: "e" },
  token: "t",
  refreshToken: "r",
  refreshExpiresAt: "re",
  connection: { manifest },
});

describe("watch", () => {
  it("keeps the chosen groups that still exist, once each, at most eight, in order", () => {
    expect(reconcileWatchSelection(["c", "gone", "a", "c"], groups)).toEqual(["c", "a"]);
    expect(reconcileWatchSelection(groups.map((group) => group.id), groups)).toHaveLength(WATCH_MAX_GROUPS);
    expect(orderedWatchGroups(["b", "a"], groups)).toEqual([{ id: "b" }, { id: "a" }]);
  });

  it("keeps each Watch's groups apart, by its lowercased id", () => {
    const selection = { watches: { "watch-1": { deviceId: "d1", groupIds: ["a"] }, "watch-2": { deviceId: "d2", groupIds: ["b", "c"] } }, timeZone: "America/New_York" };
    expect(watchGroupIds(selection, "WATCH-2")).toEqual(["b", "c"]);
    expect(watchGroupIds(selection, "watch-3")).toEqual([]);
    expect(watchGroupIds(null, "watch-1")).toEqual([]);
  });

  it("keeps a Watch's groups when it is set up again, and starts a new Watch with none", () => {
    const first = withWatch(null, "WATCH-1", "d1", "UTC");
    expect(first).toEqual({ watches: { "watch-1": { deviceId: "d1", groupIds: [] } }, timeZone: "UTC" });
    const chosen = { ...first, watches: { "watch-1": { deviceId: "d1", groupIds: ["a"] } } };
    const again = withWatch(chosen, "watch-1", "d1b", "America/New_York");
    expect(again.watches["watch-1"]).toEqual({ deviceId: "d1b", groupIds: ["a"] });
    expect(again.timeZone).toBe("America/New_York");
    expect(withWatch(again, "watch-2", "d2", "UTC").watches["watch-2"]).toEqual({ deviceId: "d2", groupIds: [] });
  });

  it("reconciles each Watch's groups and finds a Watch's entry by its paired device", () => {
    const selection = { watches: { "watch-1": { deviceId: "d1", groupIds: ["a", "gone"] }, "watch-2": { deviceId: "d2", groupIds: ["b", "b"] } }, timeZone: "UTC" };
    expect(reconcileWatches(selection, groups, "America/New_York")).toEqual({
      watches: { "watch-1": { deviceId: "d1", groupIds: ["a"] }, "watch-2": { deviceId: "d2", groupIds: ["b"] } },
      timeZone: "America/New_York",
    });
    expect(watchIdForDevice(selection, "d2")).toBe("watch-2");
    expect(watchIdForDevice(selection, "d3")).toBeNull();
    expect(watchIdForDevice(null, "d1")).toBeNull();
  });

  it("forgets the Watches no longer set up from this phone", () => {
    const selection = withWatch(withWatch(null, "watch-1", "d1", "UTC"), "watch-2", "d2", "UTC");
    expect(Object.keys(keepWatches(selection, ["d2"]).watches)).toEqual(["watch-2"]);
  });

  it("invites and claims the Watch in one call, with its id lowercased", async () => {
    const sent: unknown[] = [];
    const request = (async (path: string, init?: unknown) => {
      sent.push([path, init]);
      return {};
    }) as never;
    await enrollWatch(request, "ABC-123");
    expect(sent).toEqual([["/api/v1/paired/invites?claim=true", { method: "POST", body: { client: "watch", clientId: "abc-123" } }]]);
  });

  it("hands the Watch its own tokens and its own signed manifest, never the phone's", () => {
    const home = household();
    const profile = { instanceId: "ff_1", publicKeyX: home.x, endpoints: [], deviceId: "phone-device" };
    const manifest = home.manifest();
    const payload = watchProvisioning("WATCH-1", enrollment(manifest), profile);
    expect(payload).toEqual({
      // As enrolled: lowercased.
      watchId: "watch-1",
      deviceId: "w",
      token: "t",
      expiresAt: "e",
      refreshToken: "r",
      refreshExpiresAt: "re",
      trust: { instanceId: "ff_1", publicKeyX: home.x },
      manifest,
    });
    expect(JSON.stringify(payload)).not.toContain("phone-device");
  });

  it("never hands the Watch a manifest the household's key did not sign", () => {
    const home = household();
    const forged = home.manifest(generateKeyPairSync("ed25519"));
    expect(() => watchProvisioning("watch-1", enrollment(forged), { instanceId: "ff_1", publicKeyX: home.x })).toThrow(MANIFEST_SIGNATURE_INVALID);
  });

  it("lists the Watches this phone set up, and removes one", async () => {
    const watch = (id: string, parentDeviceId: string | null) => ({ id, parentDeviceId }) as PairedPhone;
    const sent: unknown[] = [];
    const request = (async (path: string, init?: unknown) => {
      sent.push([path, init]);
      return { devices: [watch("w1", "phone-1"), watch("w2", "phone-2")] };
    }) as never;
    expect((await listWatches(request, "phone-1")).map((each) => each.id)).toEqual(["w1"]);
    await removeWatch(request, { id: "w1" });
    expect(sent).toEqual([
      ["/api/v1/paired/devices?client=watch&status=active", undefined],
      ["/api/v1/paired/devices/w1", { method: "DELETE" }],
    ]);
  });
});
