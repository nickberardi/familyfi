import { describe, expect, it } from "vitest";
import { accessRollout, canPin, countdown, manualPairingCode, remoteChoice, savedRoute, shortPin, sortRoutes, transportLabel } from "@/lib/connection-routes";
import type { ConnectionRoute, ConnectionTransport, RouteKind } from "@/lib/types";

function route(id: string, priority = 0, kind: RouteKind = "own", transport: ConnectionTransport = "lan"): ConnectionRoute {
  return { id, url: `https://${id}.home`, kind, transport, trustMode: "system", spkiSha256: null, priority, enabled: true, edgeAuth: "none", edgeTokenVersion: null };
}

describe("connection routes", () => {
  it("labels the three transports for parents and only lets a home-network route pin", () => {
    expect(transportLabel("lan")).toBe("Home network");
    expect(transportLabel("tailscale")).toBe("Tailscale");
    expect(transportLabel("cloudflare")).toBe("Cloudflare Tunnel");
    expect(canPin("lan")).toBe(true);
    expect(canPin("tailscale")).toBe(false);
    expect(canPin("cloudflare")).toBe(false);
  });

  it("keeps insertion order for tied priorities", () => {
    expect(sortRoutes([route("b", 0), route("a", 0), route("c", -1)]).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  describe("remoteChoice", () => {
    const routes = [
      route("quick", 0, "quick", "cloudflare"),
      route("domain", 0, "domain", "cloudflare"),
      route("home", 0, "own", "lan"),
      route("tailnet", 0, "own", "tailscale"),
      route("advanced", 0, "own", "cloudflare"),
    ];

    it("reads the choice from the published route's kind, then its transport", () => {
      expect(remoteChoice({ mode: "quick", endpointId: "quick" }, routes)).toBe("quick");
      expect(remoteChoice({ mode: "named", endpointId: "domain" }, routes)).toBe("cloudflareAutomatic");
      expect(remoteChoice({ mode: "named", endpointId: "home" }, routes)).toBe("home");
      expect(remoteChoice({ mode: "named", endpointId: "tailnet" }, routes)).toBe("tailscale");
      expect(remoteChoice({ mode: "named", endpointId: "advanced" }, routes)).toBe("cloudflareAdvanced");
    });

    it("is Off when nothing is published, and follows the mode while a tunnel's first route is on its way", () => {
      expect(remoteChoice({ mode: "off", endpointId: null }, routes)).toBe("off");
      expect(remoteChoice({ mode: "quick", endpointId: null }, [])).toBe("quick");
      expect(remoteChoice({ mode: "named", endpointId: null }, [])).toBe("cloudflareAutomatic");
    });
  });

  it("finds the saved route a choice would publish again", () => {
    const routes = [route("domain", 0, "domain", "cloudflare"), route("home-b", 5), route("home-a", 1), route("tailnet", 0, "own", "tailscale"), route("quick", 0, "quick", "cloudflare")];
    expect(savedRoute("home", routes)?.id).toBe("home-a");
    expect(savedRoute("tailscale", routes)?.id).toBe("tailnet");
    expect(savedRoute("cloudflareAutomatic", routes)?.id).toBe("domain");
    expect(savedRoute("cloudflareAdvanced", routes)).toBeUndefined();
    expect(savedRoute("cloudflareAdvanced", [...routes, route("own-tunnel", 0, "own", "cloudflare")])?.id).toBe("own-tunnel");
    expect(savedRoute("quick", routes)).toBeUndefined();
    expect(savedRoute("off", routes)).toBeUndefined();
  });

  it("says how far a Cloudflare Access token has reached, and when the old one can go", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    const seen = new Date(now - 60_000).toISOString();
    const phone = (displayName: string, version: number | null, extra: { revokedAt?: string; lastSeenAt?: string | null } = {}) => ({
      displayName,
      revokedAt: extra.revokedAt ?? null,
      lastSeenAt: extra.lastSeenAt === undefined ? seen : extra.lastSeenAt,
      edgeTokens: version === null ? [] : [{ endpointId: "cf", version }],
    });
    const first = { id: "cf", edgeTokenVersion: 1 };
    const third = { id: "cf", edgeTokenVersion: 3 };
    expect(accessRollout(first, [], now)).toEqual({ done: true, text: "No active phones yet." });
    expect(accessRollout(first, [phone("A", 1), phone("B", 1)], now)).toEqual({ done: true, text: "Every active phone has the token." });
    expect(accessRollout(first, [phone("A", 1), phone("Sam's iPhone", null)], now)).toEqual({
      done: false,
      text: "1 of 2 active phones have the token. Waiting for Sam's iPhone. Cloudflare turns them away until then.",
    });
    expect(accessRollout(third, [phone("A", 2), phone("B", null), phone("C", 3)], now)).toEqual({
      done: false,
      text: "1 of 3 active phones have the new token. Waiting for A, B. Keep the old token in Cloudflare until then.",
    });
    // Revoked phones, and phones not seen within Cloudflare's longest grace period, are not waited for.
    const stale = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(accessRollout(third, [phone("C", 3), phone("Old", 1, { lastSeenAt: stale }), phone("Gone", 1, { revokedAt: seen }), phone("Never", null, { lastSeenAt: null })], now)).toEqual({
      done: true,
      text: "Every active phone has the new token. You can remove the old one in Cloudflare.",
    });
    // A token handed out for another route doesn't count.
    expect(accessRollout(first, [{ ...phone("A", null), edgeTokens: [{ endpointId: "other", version: 5 }] }], now).done).toBe(false);
  });

  it("builds the manual code the app parses and formats the countdown", () => {
    expect(manualPairingCode({ pairingId: "cm1", token: "a.b" })).toBe("cm1.a.b");
    expect(countdown(299_001)).toBe("5:00");
    expect(countdown(61_000)).toBe("1:01");
    expect(countdown(-5)).toBe("0:00");
    expect(shortPin("abcdefghijklmnopqrstuvwxyz")).toBe("abcdef…uvwxyz");
  });
});
