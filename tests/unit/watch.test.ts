import { describe, expect, it } from "vitest";
import { WATCH_MAX_GROUPS, enrollWatch, orderedWatchGroups, reconcileWatchSelection, watchProvisioning } from "@/lib/watch";

const groups = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => ({ id }));

describe("watch", () => {
  it("keeps the chosen groups that still exist, once each, at most eight, in order", () => {
    expect(reconcileWatchSelection(["c", "gone", "a", "c"], groups)).toEqual(["c", "a"]);
    expect(reconcileWatchSelection(groups.map((group) => group.id), groups)).toHaveLength(WATCH_MAX_GROUPS);
    expect(orderedWatchGroups(["b", "a"], groups)).toEqual([{ id: "b" }, { id: "a" }]);
  });

  it("enrolls the Watch as its own device, with its id lowercased", async () => {
    const sent: unknown[] = [];
    const request = (async (path: string, init?: unknown) => {
      sent.push([path, init]);
      return { deviceId: "d" };
    }) as never;
    await enrollWatch(request, "ABC-123");
    expect(sent).toEqual([["/api/v1/connection/devices", { method: "POST", body: { client: "watch", clientId: "abc-123" } }]]);
  });

  it("hands the Watch its own tokens and the household's trust, never the phone's credential", () => {
    const profile = { instanceId: "ff_1", publicKeyX: "x", endpoints: [], deviceId: "phone-device", deviceCredential: "phone-secret" };
    const enrollment = { deviceId: "w", deviceCredential: "w-secret", sessionId: "s", token: "t", expiresAt: "e", refreshToken: "r", refreshExpiresAt: "re" };
    const payload = watchProvisioning("watch-1", enrollment, profile, []);
    expect(payload).toEqual({
      watchId: "watch-1",
      deviceId: "w",
      deviceCredential: "w-secret",
      sessionId: "s",
      token: "t",
      expiresAt: "e",
      refreshToken: "r",
      refreshExpiresAt: "re",
      trust: { instanceId: "ff_1", publicKeyX: "x", endpoints: [] },
      edgeCredentials: [],
    });
    expect(JSON.stringify(payload)).not.toContain("phone-secret");
    expect(JSON.stringify(payload)).not.toContain("phone-device");
  });
});
