import { describe, expect, it } from "vitest";
import { appControlsName, enrollAppControls, findAppControls, supportsAppControls } from "@/lib/app-controls";
import type { PairedPhone } from "@/lib/types";

describe("app controls", () => {
  it("are named for their device, within the server's limit", () => {
    expect(appControlsName("Nick's iPhone")).toBe("Siri and shortcuts on Nick's iPhone");
    expect(appControlsName("  ")).toBe("Siri and shortcuts");
    expect(appControlsName(null)).toBe("Siri and shortcuts");
    expect(appControlsName("x".repeat(100))).toHaveLength(80);
  });

  it("are offered only by a server whose contract has them", () => {
    expect(supportsAppControls("1.1.0")).toBe(true);
    expect(supportsAppControls("2.0.0")).toBe(true);
    expect(supportsAppControls("1.0.0")).toBe(false);
    expect(supportsAppControls(undefined)).toBe(false);
    expect(supportsAppControls("soon")).toBe(false);
  });

  it("enroll with the claim call, as the app client with the rulesOnly scope and a lowercased id", async () => {
    const calls: { path: string; init: unknown }[] = [];
    const request = (async (path: string, init?: unknown) => {
      calls.push({ path, init });
      return {};
    }) as never;
    await enrollAppControls(request, "ABCDEF12-0000-4000-8000-000000000000", "Kitchen iPad");
    expect(calls).toEqual([
      {
        path: "/api/v1/paired/invites?claim=true",
        init: { method: "POST", body: { client: "app", scope: "rulesOnly", clientId: "abcdef12-0000-4000-8000-000000000000", displayName: "Siri and shortcuts on Kitchen iPad" } },
      },
    ]);
  });

  it("find only this app's own rulesOnly sign-in, never another app it paired", async () => {
    const devices = [
      { id: "other", client: "app", scope: "rulesOnly", parentDeviceId: "app-2" },
      { id: "paired-phone", client: "app", scope: "full", parentDeviceId: "app-1" },
      { id: "mine", client: "app", scope: "rulesOnly", parentDeviceId: "app-1" },
    ] as PairedPhone[];
    const paths: string[] = [];
    const request = (async (path: string) => {
      paths.push(path);
      return { devices };
    }) as never;
    expect((await findAppControls(request, "app-1"))?.id).toBe("mine");
    expect(await findAppControls(request, "app-3")).toBeNull();
    expect(paths[0]).toBe("/api/v1/paired/devices?client=app&status=active");
  });
});
