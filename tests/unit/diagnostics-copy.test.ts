import { describe, expect, it } from "vitest";
import { checkedAgo, formatLoad, formatPercent, formatUptime, loadTone, requestFigures, requestWindow, splitDevices } from "@/lib/diagnostics-copy";
import type { GatewayDeviceHealth } from "@/lib/types";

const device: GatewayDeviceHealth = {
  id: "device-1",
  name: "Dream Machine",
  model: "UDM Pro",
  state: "ONLINE",
  gateway: true,
  reported: true,
  cpuUtilizationPct: 18.4,
  memoryUtilizationPct: 61.6,
  loadAverage1Min: 0.62,
  loadAverage5Min: 0.5,
  loadAverage15Min: null,
  uptimeSec: 1_209_600 + 7200,
  lastHeartbeatAt: null,
};

describe("diagnostics copy", () => {
  it("shows a device's readings, and what the console did not report as unknown, never zero", () => {
    expect(formatPercent(device.cpuUtilizationPct)).toBe("18%");
    expect(formatPercent(device.memoryUtilizationPct)).toBe("62%");
    expect(formatLoad(device)).toBe("0.62 / 0.50 / —");
    expect(formatUptime(device.uptimeSec)).toBe("14 d 2 h");
    expect(formatPercent(null)).toBe("—");
    expect(formatLoad({ ...device, loadAverage1Min: null, loadAverage5Min: null })).toBe("—");
  });

  it("names uptime at the scale that reads", () => {
    expect(formatUptime(59)).toBe("0 min");
    expect(formatUptime(3 * 3600 + 5 * 60)).toBe("3 h 5 min");
    expect(formatUptime(null)).toBe("—");
  });

  it("colours a reading by how close to full it is, and an unknown one as calm", () => {
    expect(loadTone(18)).toBe("accent");
    expect(loadTone(75)).toBe("paused");
    expect(loadTone(90)).toBe("danger");
    expect(loadTone(null)).toBe("accent");
  });

  it("leads with the gateway and lists every other device, or none when the console names no gateway", () => {
    const ap = { ...device, id: "ap", name: "Living Room AP", gateway: false };
    expect(splitDevices([ap, device])).toEqual({ gateway: device, others: [ap] });
    expect(splitDevices([ap])).toEqual({ gateway: null, others: [ap] });
  });

  it("says when the readings were taken", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    expect(checkedAgo("2026-10-30T11:59:40Z", now)).toBe("checked just now");
    expect(checkedAgo("2026-10-30T11:55:00Z", now)).toBe("checked 5 min ago");
    expect(checkedAgo("2026-10-30T09:30:00Z", now)).toBe("checked 2 h ago");
  });

  it("says how many requests FamilyFi sent the console lately", () => {
    const requests = { windowSec: 300, total: 62, errors: 1, endpoints: [] };
    expect(requestFigures(requests)).toEqual([
      { value: "62", label: "requests" },
      { value: "12.4", label: "a minute" },
      { value: "1", label: "failed" },
    ]);
    expect(requestFigures({ ...requests, total: 1 })[0]).toEqual({ value: "1", label: "request" });
    expect(requestWindow(requests)).toBe("Last 5 min");
  });
});
