import { describe, expect, it, vi } from "vitest";
import type { ApiRequest } from "@/lib/api-client";
import { ALERT_KINDS } from "@/lib/alert-kinds";
import { ALERTS_SCREEN_COPY, alertChoiceRows, alertDestination, readAlertChoices, registerAlerts, setAlertChoice, supportsAlerts, unregisterAlerts } from "@/lib/alert-registration";

describe("alert registration", () => {
  it("is offered only by a server whose contract has alerts", () => {
    expect(supportsAlerts("1.4.0")).toBe(true);
    expect(supportsAlerts("1.10.2")).toBe(true);
    expect(supportsAlerts("1.3.9")).toBe(false);
    expect(supportsAlerts(null)).toBe(false);
    expect(supportsAlerts("not a version")).toBe(false);
  });

  it("registers this app's own device with the kinds this build can show", async () => {
    // The server answers each with its choices under `alerts`, as the OpenAPI document says.
    const choices = { kinds: { "device.new": true } };
    const request = vi.fn(async () => ({ alerts: choices })) as unknown as ApiRequest & ReturnType<typeof vi.fn>;
    expect(await registerAlerts(request, "dev 1", { platform: "ios", channel: "release", token: "ab12", key: "a2V5" })).toEqual(choices);
    expect(request).toHaveBeenCalledWith("/api/v1/paired/devices/dev%201/push", {
      method: "PUT",
      body: { platform: "ios", channel: "release", token: "ab12", key: "a2V5", format: 1, kinds: [...ALERT_KINDS] },
    });
    await unregisterAlerts(request, "dev 1");
    expect(request).toHaveBeenLastCalledWith("/api/v1/paired/devices/dev%201/push", { method: "DELETE" });
    expect(await readAlertChoices(request, "d")).toEqual(choices);
    expect(request).toHaveBeenLastCalledWith("/api/v1/paired/devices/d/alerts");
    expect(await setAlertChoice(request, "d", "sync.down", false)).toEqual(choices);
    expect(request).toHaveBeenLastCalledWith("/api/v1/paired/devices/d/alerts", { method: "PUT", body: { kinds: { "sync.down": false } } });
  });

  it("lists every kind, on unless the server says off", () => {
    expect(alertChoiceRows({ kinds: { "sync.up": false } })).toEqual([
      { kind: "device.new", on: true },
      { kind: "sync.down", on: true },
      { kind: "sync.up", on: false },
      { kind: "ask.new", on: true },
      { kind: "me.protection", on: true },
      { kind: "me.quiet", on: true },
    ]);
    expect(alertChoiceRows(null).every((row) => row.on)).toBe(true);
  });

  it("names every kind of alert in the Alerts screen's intro", () => {
    expect(ALERTS_SCREEN_COPY.intro).toBe("Get an alert on this device about new devices in Unassigned, your gateway, and your children's asks and phones.");
  });

  it("opens new devices in Unassigned and gateway trouble on Sync", () => {
    expect(alertDestination("device.new")).toBe("/devices?filter=loose");
    expect(alertDestination("sync.down")).toBe("/sync");
    expect(alertDestination("sync.up")).toBe("/sync");
    expect(alertDestination("something.later")).toBe("/");
    // A child's ask opens that child's group, where the parent answers it.
    expect(alertDestination("ask.new", { g: "sam" })).toBe("/family/sam");
    expect(alertDestination("ask.new")).toBe("/family");
    // News of a child's phone opens their family member, where the phone is listed.
    expect(alertDestination("me.quiet", { g: "cassie", p: "Cassie's iPad" })).toBe("/family/cassie");
    expect(alertDestination("me.protection", {})).toBe("/family");
  });
});
