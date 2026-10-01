import { describe, expect, it } from "vitest";
import { deviceDetail, deviceHref, groupHref, presenceTone } from "@/lib/device-detail";
import { formatLogWhen } from "@/lib/sync-copy";
import type { Device, Group } from "@/lib/types";

const now = new Date("2026-03-04T15:00:00Z");
const fresh = new Date(now.getTime() - 30_000).toISOString();
const old = new Date(now.getTime() - 10 * 60_000).toISOString();
const tz = "America/New_York";
const networks = [{ id: "n1", name: "Kids", vlanId: 30 }];
const device = (over: Partial<Device>) =>
  ({
    mac: "02:00:00:00:00:0a",
    hostname: "tablet",
    ip: "10.0.30.7",
    manufacturer: null,
    networkId: "n1",
    inScope: true,
    presence: "online",
    presenceCheckedAt: fresh,
    connectionType: "wireless",
    accessPointName: "Upstairs",
    connectedAt: "2026-03-04T13:00:00Z",
    lastSeenAt: "2026-03-04T14:59:00Z",
    ...over,
  }) as Device;
const group = { id: "g1", name: "A child", kind: "family" } as Group;

const rows = (detail: ReturnType<typeof deviceDetail>, title: string) =>
  Object.fromEntries(detail.sections.find((section) => section.title === title)!.rows.map((row) => [row.label, row.value]));

describe("a device's detail", () => {
  it("describes an online wireless device, with its access point and when it connected", () => {
    const detail = deviceDetail(device({}), group, networks, tz, now);
    expect(detail.status).toBe("Online");
    expect(detail.summary).toBe(`Wireless · Upstairs · connected since ${formatLogWhen("2026-03-04T13:00:00Z", tz)}`);
    expect(rows(detail, "Device")).toEqual({
      Group: "A child",
      Name: "tablet",
      "Device type": expect.any(String),
      Manufacturer: "Unknown",
      "MAC address": "02:00:00:00:00:0A",
    });
    expect(rows(detail, "Connection")).toMatchObject({
      Status: "Online",
      "Connected since": formatLogWhen("2026-03-04T13:00:00Z", tz),
      "Connection type": "Wireless",
      "Access point": "Upstairs",
      Network: "Kids",
      "IP address": "10.0.30.7",
    });
    const groupRow = detail.sections[0]!.rows[0]!;
    expect(groupRow.group).toBe(group);
    expect(detail.sections[0]!.rows.find((row) => row.label === "MAC address")?.mono).toBe(true);
  });

  it("shows when an offline device was last seen, and no access point for a wired one", () => {
    const detail = deviceDetail(device({ presence: "offline", connectionType: "wired" }), null, networks, tz, now);
    expect(detail.summary).toBe(`Last seen ${formatLogWhen("2026-03-04T14:59:00Z", tz)}`);
    expect(rows(detail, "Device").Group).toBe("Unassigned");
    expect(rows(detail, "Connection")).not.toHaveProperty("Access point");
    expect(rows(detail, "Connection")).not.toHaveProperty("Connected since");
    expect(rows(detail, "Connection")["Last seen"]).toBe(formatLogWhen("2026-03-04T14:59:00Z", tz));
  });

  it("says when an old check was made, and that a device never checked is unknown", () => {
    const stale = deviceDetail(device({ presenceCheckedAt: old }), group, networks, tz, now);
    expect(stale.presence).toBe("stale_online");
    expect(stale.summary).toBe(`Presence checked ${formatLogWhen(old, tz)}`);
    const unknown = deviceDetail(device({ presenceCheckedAt: null, ip: null }), group, [], tz, now);
    expect(unknown.summary).toBe("No successful presence check yet");
    expect(rows(unknown, "Connection")).toMatchObject({ Checked: "Never checked", "IP address": "Unknown", Network: "n1" });
  });

  it("colours presence green when online, amber when the check is old, and grey otherwise", () => {
    expect(presenceTone("online")).toEqual({ ink: "on-ink", fill: "on-tint" });
    expect(presenceTone("stale_offline")).toEqual({ ink: "paused", fill: "paused-fill" });
    expect(presenceTone("unknown")).toEqual({ ink: "muted", fill: "field" });
  });

  it("links to a group's page, and to a device from a group so the way back returns there", () => {
    expect(groupHref({ id: "g1", kind: "family" })).toBe("/family/g1");
    expect(groupHref({ id: "g2", kind: "things" })).toBe("/things/g2");
    expect(deviceHref({ mac: "02:00:00:00:00:0a" })).toBe("/devices/02%3A00%3A00%3A00%3A00%3A0a");
    expect(deviceHref({ mac: "02:00:00:00:00:0a" }, "g1")).toBe("/devices/02%3A00%3A00%3A00%3A00%3A0a?from=g1");
  });
});
