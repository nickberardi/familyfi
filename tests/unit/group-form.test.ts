import { describe, expect, it } from "vitest";
import {
  deleteGroupConfirm,
  groupEditBody,
  groupEditDraft,
  monogramPlaceholder,
  newGroupBody,
  newGroupCopy,
  normalizeMonogram,
  roleLocked,
} from "@/lib/group-form";
import type { Group } from "@/lib/types";

const group = (overrides: Partial<Group> = {}) =>
  ({ id: "g1", name: "Sam", kind: "family", familyRole: "child", monogram: null, ...overrides }) as Group;

describe("adding a group", () => {
  it("asks a family member for a role and a Things group for a monogram", () => {
    expect(newGroupCopy("family")).toMatchObject({ title: "New family member", create: "Add person" });
    expect(newGroupCopy("things")).toMatchObject({ title: "New group", create: "Create group" });
    expect(newGroupBody({ kind: "family", name: " Sam ", familyRole: "teen", monogram: "XX" })).toEqual({
      kind: "family",
      name: "Sam",
      familyRole: "teen",
      monogram: undefined,
    });
    expect(newGroupBody({ kind: "things", name: "Consoles", familyRole: "adult", monogram: " " })).toEqual({
      kind: "things",
      name: "Consoles",
      familyRole: undefined,
      monogram: undefined,
    });
  });

  it("sends nothing without a name", () => {
    expect(newGroupBody({ kind: "family", name: "   ", familyRole: "child", monogram: "" })).toBeNull();
  });

  it("keeps a monogram to four capitals and suggests one from the name", () => {
    expect(normalizeMonogram("tvroom")).toBe("TVRO");
    expect(monogramPlaceholder(" consoles")).toBe("CO");
    expect(monogramPlaceholder("")).toBe("e.g. TV");
  });
});

describe("editing a group", () => {
  it("sends only a real change", () => {
    const sam = group();
    expect(groupEditBody(sam, groupEditDraft(sam))).toBeNull();
    expect(groupEditBody(sam, { ...groupEditDraft(sam), name: "  " })).toBeNull();
    expect(groupEditBody(sam, { ...groupEditDraft(sam), familyRole: "teen" })).toEqual({ name: "Sam", familyRole: "teen" });
    const tv = group({ kind: "things", familyRole: null, monogram: "TV", name: "TVs" });
    expect(groupEditBody(tv, { ...groupEditDraft(tv), monogram: "" })).toEqual({ name: "TVs", monogram: null });
  });

  it("locks the role of a member with a personal login, not the recovery account's", () => {
    expect(roleLocked(group(), [{ recovery: false, groupId: "g1" }])).toBe(true);
    expect(roleLocked(group(), [{ recovery: true, groupId: "g1" }, { recovery: false, groupId: "g2" }])).toBe(false);
  });

  it("says what deleting does before it happens", () => {
    expect(deleteGroupConfirm(group())).toMatchObject({ title: "Delete Sam?", confirm: "Delete group", cancel: "Never mind" });
  });
});
