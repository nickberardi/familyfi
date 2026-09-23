import { describe, expect, it } from "vitest";
import { canPin, countdown, manualPairingCode, nextPriority, reorderRoutes, shortPin, sortRoutes, transportLabel } from "@/lib/connection-routes";
import type { ConnectionRoute } from "@/lib/types";

function route(id: string, priority: number): ConnectionRoute {
  return { id, url: `https://${id}.home`, transport: "lan", trustMode: "system", spkiSha256: null, priority, enabled: true };
}

describe("connection routes", () => {
  it("labels transports for parents and only lets LAN pin", () => {
    expect(transportLabel("tailscale")).toBe("Tailscale Serve");
    expect(canPin("lan")).toBe(true);
    expect(canPin("vpn")).toBe(false);
  });

  it("keeps insertion order for tied priorities", () => {
    expect(sortRoutes([route("b", 0), route("a", 0), route("c", -1)]).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("renumbers on reorder so no two routes tie", () => {
    const routes = [route("a", 0), route("b", 0), route("c", 0)];
    expect(reorderRoutes(routes, "c", -1)).toEqual([
      { id: "c", priority: 10 },
      { id: "b", priority: 20 },
    ]);
    expect(reorderRoutes(routes, "a", -1)).toEqual([]);
    expect(reorderRoutes(routes, "c", 1)).toEqual([]);
  });

  it("puts a new route last", () => {
    expect(nextPriority([])).toBe(0);
    expect(nextPriority([route("a", 0), route("b", 30)])).toBe(40);
    expect(nextPriority([route("a", 995)])).toBe(999);
  });

  it("builds the manual code the app parses and formats the countdown", () => {
    expect(manualPairingCode({ pairingId: "cm1", token: "a.b" })).toBe("cm1.a.b");
    expect(countdown(299_001)).toBe("5:00");
    expect(countdown(61_000)).toBe("1:01");
    expect(countdown(-5)).toBe("0:00");
    expect(shortPin("abcdefghijklmnopqrstuvwxyz")).toBe("abcdef…uvwxyz");
  });
});
