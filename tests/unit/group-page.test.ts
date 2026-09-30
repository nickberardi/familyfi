import { describe, expect, it } from "vitest";
import { groupPageSummary, groupPageTitle } from "@/lib/group-page";
import type { Group } from "@/lib/types";

const row = (name: string, access: Group["access"], kind: Group["kind"] = "family") => ({ name, access, kind });

describe("group page heading", () => {
  it("titles each page", () => {
    expect(groupPageTitle("family")).toBe("Family");
    expect(groupPageTitle("things")).toBe("Things");
  });

  it("names who is paused and who is in a no-internet window on Family", () => {
    expect(groupPageSummary("family", [row("A child", "paused"), row("A teen", "blocked"), row("Another teen", "blocked"), row("An adult", "available")])).toBe(
      "A child paused · A teen and Another teen in a no-internet window",
    );
    expect(groupPageSummary("family", [row("A child", "paused")])).toBe("A child paused");
  });

  it("says everyone is online, ignoring Things groups", () => {
    expect(groupPageSummary("family", [row("An adult", "available"), row("Printers", "paused", "things")])).toBe("Everyone online right now");
  });

  it("describes the Things page", () => {
    expect(groupPageSummary("things", [])).toBe("Device groups that are not a person. House destinations are Things groups.");
  });
});
