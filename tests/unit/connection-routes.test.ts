import { describe, expect, it } from "vitest";
import { accessRollout, addressConflict, canPin, countdown, homeAddress, homeOrigin, isPrivateOrigin, ownRouteStatus, remoteChoice, remoteStatus, removeRouteConfirm, routeForAddress, routeTrust, savedRoute, savedRoutes, shortPin, sortRoutes, transportLabel } from "@/lib/connection-routes";
import type { ConnectionRoute, ConnectionTransport, RouteKind } from "@/lib/types";

function route(id: string, priority = 0, kind: RouteKind = "own", transport: ConnectionTransport = "lan"): ConnectionRoute {
  return { id, url: `https://${id}.home`, kind, transport, trustMode: "system", spkiSha256: null, priority, enabled: true, edgeAuth: "none", edgeTokenVersion: null };
}

describe("connection routes", () => {
  it("labels the three transports for parents and only lets a home-network route pin", () => {
    expect(transportLabel("lan")).toBe("My domain");
    expect(transportLabel("tailscale")).toBe("Tailscale");
    expect(transportLabel("cloudflare")).toBe("Cloudflare Tunnel");
    expect(canPin("lan")).toBe(true);
    expect(canPin("tailscale")).toBe(false);
    expect(canPin("cloudflare")).toBe(false);
  });

  it("takes an http or https origin as the home network address, and nothing more", () => {
    expect(homeOrigin("http://192.168.1.10:7001/")).toBe("http://192.168.1.10:7001");
    expect(homeOrigin(" https://familyfi.home.arpa ")).toBe("https://familyfi.home.arpa");
    for (const value of ["", "familyfi.local", "ftp://192.168.1.10", "http://192.168.1.10/familyfi", "http://192.168.1.10/?a=1", "http://192.168.1.10/#x", "https://user:pass@familyfi.home.arpa"]) {
      expect(homeOrigin(value)).toBeNull();
    }
  });

  it("calls only addresses that can't be reached from outside a home private", () => {
    for (const origin of ["http://10.0.0.5:7001", "http://172.16.0.1", "http://172.31.255.255", "http://192.168.1.10:7001", "http://127.0.0.1:7001", "http://169.254.1.1", "http://100.64.0.1", "http://localhost:7001", "http://familyfi.local:7001", "https://familyfi.home.arpa", "http://[::1]:7001", "http://[fd12:3456::1]", "http://[fe80::1]"]) {
      expect(isPrivateOrigin(origin), origin).toBe(true);
    }
    for (const origin of ["https://familyfi.example.com", "http://172.32.0.1", "http://100.128.0.1", "http://8.8.8.8", "http://192.169.1.1", "https://local.example.com", "http://[2001:db8::1]", "not a url"]) {
      expect(isPrivateOrigin(origin), origin).toBe(false);
    }
  });

  it("says how a phone trusts a route: its pin or the system, and Access in front", () => {
    const pin = "a".repeat(43);
    expect(routeTrust({ trustMode: "pinned", spkiSha256: pin, edgeAuth: "none" })).toBe(`Pinned certificate ${shortPin(pin)}`);
    expect(routeTrust({ trustMode: "system", spkiSha256: null, edgeAuth: "serviceToken" })).toBe(
      "Certificate checked by the system · behind Cloudflare Access",
    );
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
      expect(remoteChoice({ mode: "named", endpointId: "home" }, routes)).toBe("myDomain");
      expect(remoteChoice({ mode: "named", endpointId: "tailnet" }, routes)).toBe("tailscale");
      expect(remoteChoice({ mode: "named", endpointId: "advanced" }, routes)).toBe("cloudflareAdvanced");
    });

    it("is Off when nothing is published, and follows the mode while a tunnel's first route is on its way", () => {
      expect(remoteChoice({ mode: "off", endpointId: null }, routes)).toBe("off");
      expect(remoteChoice({ mode: "quick", endpointId: null }, [])).toBe("quick");
      expect(remoteChoice({ mode: "named", endpointId: null }, [])).toBe("cloudflareAutomatic");
    });
  });

  describe("routeForAddress", () => {
    const routes = [route("home"), route("tailnet", 0, "own", "tailscale"), route("advanced", 0, "own", "cloudflare"), route("quick", 0, "quick", "cloudflare"), route("domain", 0, "domain", "cloudflare")];

    it("reuses a saved route of the same transport at the same origin", () => {
      expect(routeForAddress(routes, " https://tailnet.home/ ", "tailscale")).toEqual({ reuse: routes[1] });
      expect(routeForAddress(routes, "https://advanced.home", "cloudflare")).toEqual({ reuse: routes[2] });
    });

    it("reports a route of another transport, or FamilyFi's own tunnel, as a conflict", () => {
      expect(routeForAddress(routes, "https://tailnet.home", "lan")).toEqual({ conflict: routes[1] });
      expect(routeForAddress(routes, "https://home.home", "cloudflare")).toEqual({ conflict: routes[0] });
      expect(routeForAddress(routes, "https://quick.home", "cloudflare")).toEqual({ conflict: routes[3] });
      expect(routeForAddress(routes, "https://domain.home", "lan")).toEqual({ conflict: routes[4] });
    });

    it("finds nothing for a new or unreadable address", () => {
      expect(routeForAddress(routes, "https://new.home", "lan")).toBeNull();
      expect(routeForAddress(routes, "not a url", "lan")).toBeNull();
    });

    it("names the choice that already holds the address", () => {
      expect(addressConflict(routes[1]!)).toBe("This address is already saved as your Tailscale route. Choose Tailscale to use it, or enter a different address.");
      expect(addressConflict(routes[0]!)).toContain("your My domain route. Choose My domain");
      expect(addressConflict(routes[2]!)).toContain("Choose Cloudflare Advanced");
      expect(addressConflict(routes[3]!)).toContain("Choose Quick tunnel");
      expect(addressConflict(routes[4]!)).toContain("Choose Cloudflare Automatic");
    });
  });

  it("finds the saved route a choice would publish again", () => {
    const routes = [route("domain", 0, "domain", "cloudflare"), route("home-b", 5), route("home-a", 1), route("tailnet", 0, "own", "tailscale"), route("quick", 0, "quick", "cloudflare")];
    expect(savedRoute("myDomain", routes)?.id).toBe("home-a");
    expect(savedRoute("tailscale", routes)?.id).toBe("tailnet");
    expect(savedRoute("cloudflareAutomatic", routes)?.id).toBe("domain");
    expect(savedRoute("cloudflareAdvanced", routes)).toBeUndefined();
    expect(savedRoute("cloudflareAdvanced", [...routes, route("own-tunnel", 0, "own", "cloudflare")])?.id).toBe("own-tunnel");
    expect(savedRoute("quick", routes)).toBeUndefined();
    expect(savedRoute("off", routes)).toBeUndefined();
  });

  it("lists every saved route of a choice the household runs, in the order phones try them", () => {
    const routes = [route("domain", 0, "domain", "cloudflare"), route("home-b", 5), route("home-a", 1), route("tailnet-b", 3, "own", "tailscale"), route("tailnet-a", 0, "own", "tailscale")];
    expect(savedRoutes("myDomain", routes).map((item) => item.id)).toEqual(["home-a", "home-b"]);
    expect(savedRoutes("tailscale", routes).map((item) => item.id)).toEqual(["tailnet-a", "tailnet-b"]);
    expect(savedRoutes("cloudflareAutomatic", routes)).toEqual([]);
    expect(savedRoutes("quick", routes)).toEqual([]);
  });

  it("warns that removing the published route turns remote access off, and counts the phones paired through it", () => {
    const home = { url: "https://familyfi.home" };
    expect(removeRouteConfirm(home, { published: false, pairedCount: 0 })).toEqual({ title: "Remove https://familyfi.home?", message: "Phones aren't using it now.", confirmLabel: "Remove" });
    expect(removeRouteConfirm(home, { published: false, pairedCount: 1 }).message).toBe("Phones aren't using it now. 1 phone first paired through it.");
    expect(removeRouteConfirm(home, { published: true, pairedCount: 0 }).message).toBe("Phones reach home through it now, so remote access turns off.");
    expect(removeRouteConfirm(home, { published: true, pairedCount: 2 }).message).toBe(
      "Phones reach home through it now, so remote access turns off. 2 phones paired through it can't reach home from outside until you publish another route.",
    );
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
      text: "1 of 2 active phones have the token. Waiting for Sam's iPhone. Create the Access application in Cloudflare after that; if it already exists, Cloudflare turns them away until then.",
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

  it("formats the countdown", () => {
    expect(countdown(299_001)).toBe("5:00");
    expect(countdown(61_000)).toBe("1:01");
    expect(countdown(-5)).toBe("0:00");
    expect(shortPin("abcdefghijklmnopqrstuvwxyz")).toBe("abcdef…uvwxyz");
  });
});

describe("homeAddress", () => {
  it("prefers the saved address, then a private current address, else none", () => {
    expect(homeAddress({ url: "http://familyfi.local:7001", current: { url: "http://192.168.1.10:7001", private: true } })).toBe("http://familyfi.local:7001");
    expect(homeAddress({ url: null, current: { url: "http://192.168.1.10:7001", private: true } })).toBe("http://192.168.1.10:7001");
    expect(homeAddress({ url: null, current: { url: "https://familyfi.example.com", private: false } })).toBeNull();
  });

  describe("a route the household runs", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    const nothing = { reachedAt: null, checkedAt: null, result: null, message: null } as const;

    it("is never On without evidence", () => {
      expect(ownRouteStatus(nothing, now)).toEqual({ label: "Published", ink: "var(--ff-muted)", detail: "Nothing has come in through this address yet." });
      expect(remoteStatus({ status: "running", reachability: nothing }, now).label).toBe("Published");
    });

    it("says when a phone last came in through it, or FamilyFi's own check reached it", () => {
      expect(ownRouteStatus({ ...nothing, reachedAt: "2026-10-18T11:55:00Z" }, now)).toEqual({ label: "Reached 5m ago", ink: "var(--ff-on-ink)", detail: null });
      expect(ownRouteStatus({ ...nothing, checkedAt: "2026-10-18T11:59:40Z", result: "reached" }, now).label).toBe("Reached just now");
      // The newer of the two.
      expect(ownRouteStatus({ reachedAt: "2026-10-18T09:00:00Z", checkedAt: "2026-10-18T11:00:00Z", result: "reached", message: null }, now).label).toBe("Reached 1h ago");
    });

    it("is Not reached only when a check failed and nothing has come in through it", () => {
      const failed = { ...nothing, checkedAt: "2026-10-18T11:59:00Z", result: "failed", message: "No answer from familyfi.example.com within 5 seconds." } as const;
      expect(ownRouteStatus(failed, now)).toEqual({
        label: "Not reached",
        ink: "var(--ff-danger)",
        detail: "No phone has come in through this address, and FamilyFi couldn't reach it. No answer from familyfi.example.com within 5 seconds.",
      });
      // A check from inside the home can fail while phones come in from outside.
      expect(ownRouteStatus({ ...failed, reachedAt: "2026-10-18T10:00:00Z" }, now)).toEqual({
        label: "Reached 2h ago",
        ink: "var(--ff-on-ink)",
        detail: "Couldn't check from FamilyFi. No answer from familyfi.example.com within 5 seconds.",
      });
      // A phone that came in after the failed check settles it.
      expect(ownRouteStatus({ ...failed, reachedAt: "2026-10-18T11:59:30Z" }, now)).toEqual({ label: "Reached just now", ink: "var(--ff-on-ink)", detail: null });
    });

    it("leaves FamilyFi's own tunnel to its status", () => {
      expect(remoteStatus({ status: "running", reachability: null }, now)).toEqual({ label: "On", ink: "var(--ff-on-ink)", detail: null });
      expect(remoteStatus(null, now).label).toBe("Off");
    });
  });
});
