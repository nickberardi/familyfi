import { describe, expect, it } from "vitest";
import { consoleAddress, findGatewayDevice, networkGatewayAddresses } from "@/server/unifi/gateway-device";
import type { NetworkDetails, SiteDeviceOverview } from "@/server/unifi/types";

const BASE = [consoleAddress("https://192.168.1.1/proxy/network/integration")];
const ap: SiteDeviceOverview = { id: "ap", name: "Living Room AP", model: "U7 Pro", ipAddress: "192.168.1.20", features: ["accessPoint"] };
const switcher: SiteDeviceOverview = { id: "switch", name: "Office Switch", model: "USW Lite 8 PoE", ipAddress: "192.168.1.30", features: ["switching"] };

describe("which device is the gateway", () => {
  it("takes the device the console says has the gateway feature first", () => {
    const flagged = { id: "gw", name: "Dream Machine", model: "UDM Pro", ipAddress: "203.0.113.4", features: ["gateway", "switching"] };
    // Another device at the console's address does not outrank the console's own word.
    expect(findGatewayDevice([{ ...ap, ipAddress: "192.168.1.1" }, flagged], BASE)).toBe(flagged);
  });

  it("falls back to the device at the address FamilyFi reaches the console on", () => {
    const unmarked = { id: "unmarked", name: "Dream Machine", model: "UDM Pro SE", ipAddress: "192.168.1.1", features: ["switching"] };
    expect(findGatewayDevice([ap, switcher, unmarked], BASE)).toBe(unmarked);
    const v6 = [consoleAddress("https://[fd00::1]/proxy/network/integration")];
    expect(findGatewayDevice([ap, { ...unmarked, model: "Something new" }], v6)).toBeNull();
    expect(findGatewayDevice([ap, { ...unmarked, model: "Something new", ipAddress: "FD00::1" }], v6)?.id).toBe("unmarked");
  });

  it("matches the gateway's address on any of its networks, whichever one FamilyFi talks to", () => {
    const network = (id: string, hostIpAddress?: string): NetworkDetails => ({
      id, name: id, default: false, enabled: true, management: "GATEWAY", vlanId: 1,
      ...(hostIpAddress ? { ipv4Configuration: { hostIpAddress, prefixLength: 24 } } : {}),
    });
    const networks = [network("lan", "10.1.0.1"), network("kids", "10.1.0.2"), network("iot", "10.1.0.5"), network("unread")];
    expect(networkGatewayAddresses(networks)).toEqual(["10.1.0.1", "10.1.0.2", "10.1.0.5"]);
    const unmarked = { id: "unmarked", name: "Dream Machine", model: "Something new", ipAddress: "10.1.0.5", features: ["switching"] };
    const addresses = [...networkGatewayAddresses(networks), consoleAddress("https://10.1.0.10/proxy/network/integration")];
    expect(findGatewayDevice([ap, switcher, unmarked], addresses)).toBe(unmarked);
    // A network's own gateway outranks another console at the integration URL's address.
    const cloudKey = { id: "ck", name: "Cloud Key", model: "UCK G2 Plus", ipAddress: "10.1.0.10", features: [] };
    expect(findGatewayDevice([cloudKey, unmarked], addresses)).toBe(unmarked);
  });

  it("matches a gateway model only when neither the feature nor the address names one", () => {
    const unmarked = { id: "unmarked", name: "Dream Machine", model: "UDM Pro SE", ipAddress: "203.0.113.4", features: ["switching"] };
    expect(findGatewayDevice([ap, switcher, unmarked], BASE)).toBe(unmarked);
    // A cloud connection has no local address to match.
    expect(findGatewayDevice([ap, switcher, unmarked], [])).toBe(unmarked);
    for (const model of ["UCG Ultra", "UCG-Max", "UXG Pro", "UDR7", "USG 3P", "UX", "UX7", "EFG"]) {
      expect(findGatewayDevice([ap, { ...unmarked, model }], [])?.id, model).toBe("unmarked");
    }
    // Switches, access points, a Cloud Key and the Express's lookalikes are never taken for a gateway.
    for (const model of ["USW Pro 24", "U7 Pro", "UCK G2 Plus", "UXBSDM", "USP Plug"]) {
      expect(findGatewayDevice([ap, { ...unmarked, model }], []), model).toBeNull();
    }
  });

  it("reads the console's address only from a local integration URL", () => {
    expect(consoleAddress("https://[FD00::1]/proxy/network/integration")).toBe("fd00::1");
    expect(consoleAddress(null)).toBeNull();
    expect(consoleAddress("not a url")).toBeNull();
  });

  it("names no gateway when nothing points to one", () => {
    expect(findGatewayDevice([ap, switcher], BASE)).toBeNull();
    expect(findGatewayDevice([], BASE)).toBeNull();
  });
});
