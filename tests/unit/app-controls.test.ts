import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { appControlsName, enrollAppControls, findAppControls, setUpAppControls, SIRI_SHORTCUTS_COPY, supportsAppControls } from "@/lib/app-controls";
import type { PairedPhone } from "@/lib/types";

describe("app controls", () => {
  it("are named for their device in its platform's words, within the server's limit", () => {
    expect(appControlsName("apple", "Nick's iPhone")).toBe("Siri and Shortcuts on Nick's iPhone");
    expect(appControlsName("android", "Pixel 9")).toBe("Quick Settings and shortcuts on Pixel 9");
    expect(appControlsName("apple", "  ")).toBe("Siri and Shortcuts");
    expect(appControlsName("android", null)).toBe("Quick Settings and shortcuts");
    expect(appControlsName("apple", "x".repeat(100))).toHaveLength(80);
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
    await enrollAppControls(request, "ABCDEF12-0000-4000-8000-000000000000", "apple", "Kitchen iPad");
    expect(calls).toEqual([
      {
        path: "/api/v1/paired/invites?claim=true",
        init: { method: "POST", body: { client: "app", scope: "rulesOnly", clientId: "abcdef12-0000-4000-8000-000000000000", displayName: "Siri and Shortcuts on Kitchen iPad" } },
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

  describe("set up", () => {
    // A household key and a manifest it signs, as the server signs one.
    const keys = generateKeyPairSync("ed25519");
    const profile = { instanceId: "ff_1", publicKeyX: (keys.publicKey.export({ format: "jwk" }) as { x: string }).x };
    const bytes = Buffer.from(JSON.stringify({ instanceId: "ff_1", endpoints: [], edgeCredentials: [] }));
    const manifest = { signedPayload: bytes.toString("base64url"), signature: sign(null, bytes, keys.privateKey).toString("base64url") };
    const enrollment = { device: { id: "device-1", displayName: "Siri and Shortcuts" }, session: { expiresAt: "e" }, token: "bearer", refreshToken: "refresh", refreshExpiresAt: "re", connection: { manifest } };
    const bridge = (provisioned: boolean) => {
      const stored: string[] = [];
      return { stored, clientId: async () => "ABCDEF12-0000-4000-8000-000000000000", isProvisioned: async () => provisioned, provision: async (json: string) => void stored.push(json) };
    };
    const server = (apiVersion: string | undefined, claim: () => unknown) => {
      const paths: string[] = [];
      const request = (async (path: string) => {
        paths.push(path);
        return path === "/api/v1/health" ? { apiVersion } : claim();
      }) as never;
      return { paths, request };
    };

    it("asks nothing of the server while the controls hold a sign-in", async () => {
      const { paths, request } = server("1.1.0", () => enrollment);
      expect(await setUpAppControls({ bridge: bridge(true), request, profile, platform: "apple" })).toBe("ready");
      expect(paths).toEqual([]);
    });

    it("claims a sign-in under the controls' id and hands it to the native side", async () => {
      const native = bridge(false);
      const { paths, request } = server("1.1.0", () => enrollment);
      expect(await setUpAppControls({ bridge: native, request, profile, platform: "apple", deviceName: "Kitchen iPad" })).toBe("ready");
      expect(paths).toEqual(["/api/v1/health", "/api/v1/paired/invites?claim=true"]);
      expect(native.stored).toHaveLength(1);
      expect(JSON.parse(native.stored[0]!)).toMatchObject({ watchId: "abcdef12-0000-4000-8000-000000000000", deviceId: "device-1", token: "bearer", refreshToken: "refresh", trust: profile, manifest });
    });

    it("reads an older server, or one that refuses the claim as invalid, as unsupported, and claims nothing from the first", async () => {
      const old = server("1.0.0", () => enrollment);
      expect(await setUpAppControls({ bridge: bridge(false), request: old.request, profile, platform: "android" })).toBe("unsupported");
      expect(old.paths).toEqual(["/api/v1/health"]);
      const early = server("1.1.0", () => {
        throw new ApiError("Invalid request.", 400, "invalid_request");
      });
      const native = bridge(false);
      expect(await setUpAppControls({ bridge: native, request: early.request, profile, platform: "android" })).toBe("unsupported");
      expect(native.stored).toEqual([]);
    });

    it("leaves any other failure to the next try", async () => {
      const refused = server("1.1.0", () => {
        throw new ApiError("That id belongs to another device.", 409, "client_id_in_use");
      });
      await expect(setUpAppControls({ bridge: bridge(false), request: refused.request, profile, platform: "apple" })).rejects.toThrow("another device");
    });
  });

  it("gives an example phrase for each of the five actions, each naming FamilyFi", () => {
    const phrases = SIRI_SHORTCUTS_COPY.phrases("Abby");
    expect(phrases).toHaveLength(5);
    for (const phrase of phrases) expect(phrase).toMatch(/Abby.* in FamilyFi/);
  });
});
