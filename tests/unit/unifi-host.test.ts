import { describe, expect, it } from "vitest";
import { consoleHostFromBaseUrl, localIntegrationBaseFromHost } from "@/lib/unifi-host";

describe("local UniFi host", () => {
  it("builds the integration base from an IP", () => {
    expect(localIntegrationBaseFromHost("10.1.2.1")).toBe("https://10.1.2.1/proxy/network/integration");
  });

  it("keeps an optional port", () => {
    expect(localIntegrationBaseFromHost("10.1.2.1:8443")).toBe("https://10.1.2.1:8443/proxy/network/integration");
  });

  it("recovers if someone pastes the full URL", () => {
    expect(localIntegrationBaseFromHost("https://10.1.2.1/proxy/network/integration")).toBe(
      "https://10.1.2.1/proxy/network/integration",
    );
  });

  it("reads the host back from a stored base URL", () => {
    expect(consoleHostFromBaseUrl("https://10.1.2.1/proxy/network/integration")).toBe("10.1.2.1");
  });
});
