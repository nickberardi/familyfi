import { describe, expect, it } from "vitest";
import { ALERT_FALLBACK_TEXT, ALERT_KIND_LABELS, ALERTS_CARD_COPY, alertText } from "@/lib/alert-copy";
import { ALERT_KINDS, isAlertKind } from "@/lib/alert-kinds";

describe("alert copy", () => {
  it("names one new device by hostname, and counts several", () => {
    expect(alertText("device.new", { n: 1, h: "Kids-iPad" })?.body).toBe("Kids-iPad is waiting in Unassigned.");
    expect(alertText("device.new", { n: 1 })?.body).toBe("A new device is waiting in Unassigned.");
    expect(alertText("device.new", { n: 1, h: "  " })?.body).toBe("A new device is waiting in Unassigned.");
    expect(alertText("device.new", { n: 3 })).toEqual({ title: "New devices", body: "3 new devices are waiting in Unassigned." });
    // Data a reader cannot use falls back to one device rather than a wrong count.
    expect(alertText("device.new", { n: "lots" })?.body).toBe("A new device is waiting in Unassigned.");
  });

  it("says when sync is in trouble and when it is back", () => {
    expect(alertText("sync.down", {})?.body).toBe("FamilyFi can't reach your gateway. Rules may not be applied.");
    expect(alertText("sync.up", {})?.body).toBe("FamilyFi is syncing again.");
  });

  it("has words for every kind, and none for a kind it does not know", () => {
    for (const kind of ALERT_KINDS) {
      expect(alertText(kind, { n: 1 }), kind).not.toBeNull();
      expect(ALERT_KIND_LABELS[kind], kind).toBeTruthy();
    }
    expect(alertText("pause.ending", {})).toBeNull();
    expect(isAlertKind("pause.ending")).toBe(false);
  });

  it("says Unassigned to parents, never quarantined", () => {
    const words = JSON.stringify([ALERT_FALLBACK_TEXT, ALERT_KIND_LABELS, ALERTS_CARD_COPY, ...ALERT_KINDS.map((kind) => alertText(kind, { n: 2 }))]);
    expect(words.toLowerCase()).not.toContain("quarantin");
  });
});
