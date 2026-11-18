import { describe, expect, it } from "vitest";
import { ALERT_ACTIONS, ALERT_FALLBACK_TEXT, ALERT_KIND_LABELS, ALERTS_CARD_COPY, alertText } from "@/lib/alert-copy";
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
    expect(alertText("sync.down", {})?.body).toBe("Your rules may not apply until FamilyFi reaches it again.");
    expect(alertText("sync.up", {})?.body).toBe("FamilyFi can reach your gateway again.");
  });

  it("says who asked for more time, and for what", () => {
    expect(alertText("ask.new", { g: "g1", n: "Sam", a: "pause" })).toEqual({ title: "Sam asked to be unpaused", body: "Open FamilyFi to answer." });
    expect(alertText("ask.new", { g: "g1", n: "Sam", a: "rule", r: "Bedtime", m: 30 })).toEqual({
      title: "Sam asked for more time",
      body: "30 minutes off Bedtime.",
    });
    expect(alertText("ask.new", { g: "g1", n: "Sam", a: "rule", r: "Homework", m: 90 })?.body).toBe("1 hour 30 minutes off Homework.");
    expect(alertText("ask.new", { n: "Sam", a: "rule", r: "Bedtime" })?.body).toBe("Time off Bedtime.");
    // Data a reader cannot use still makes a sentence.
    // On a shared Thing: the child, and the Thing they asked about.
    expect(alertText("ask.new", { g: "tv", n: "Cassie", t: "TV", a: "pause" })).toEqual({ title: "Cassie asked to unpause TV", body: "Open FamilyFi to answer." });
    expect(alertText("ask.new", { g: "tv", n: "Cassie", t: "TV", a: "rule", r: "TV downtime", m: 30 })).toEqual({ title: "Cassie asked for more time on TV", body: "30 minutes off TV downtime." });
    expect(alertText("ask.new", { a: "rule", m: "lots" })).toEqual({ title: "Your child asked for more time", body: "Open FamilyFi to answer." });
  });

  it("says which child's phone lost Screen Time or went quiet", () => {
    expect(alertText("me.protection", { p: "Cassie's iPad", n: "Cassie" })).toEqual({
      title: "Screen Time is off on Cassie's iPad",
      body: "Allow FamilyFi Me in Screen Time on that phone so it can block apps.",
    });
    expect(alertText("me.protection", {})?.title).toBe("Screen Time is off on a child's phone");
    expect(alertText("me.quiet", { p: "Cassie's iPad" })).toEqual({
      title: "Cassie's iPad isn't checking in",
      body: "It hasn't reached FamilyFi for a day. It may be off or offline.",
    });
    expect(alertText("me.quiet", {})?.title).toBe("A child's phone isn't checking in");
  });

  it("has words for every kind, and none for a kind it does not know", () => {
    for (const kind of ALERT_KINDS) {
      expect(alertText(kind, { n: 1 }), kind).not.toBeNull();
      expect(ALERT_KIND_LABELS[kind], kind).toBeTruthy();
    }
    expect(alertText("pause.ending", {})).toBeNull();
    for (const kind of Object.keys(ALERT_ACTIONS)) expect(ALERT_KINDS, kind).toContain(kind);
    expect(isAlertKind("pause.ending")).toBe(false);
  });

  it("says Unassigned to parents, never quarantined", () => {
    const words = JSON.stringify([ALERT_FALLBACK_TEXT, ALERT_ACTIONS, ALERT_KIND_LABELS, ALERTS_CARD_COPY, ...ALERT_KINDS.map((kind) => alertText(kind, { n: 2 }))]);
    expect(words.toLowerCase()).not.toContain("quarantin");
  });
});
