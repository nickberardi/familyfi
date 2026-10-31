import { describe, expect, it } from "vitest";
import {
  rulesNeedDevice,
  deleteGroupConfirm,
  groupEditBody,
  groupDetailSub,
  groupEditDraft,
  groupEditError,
  groupEditSheetDraft,
  groupResolverEdit,
  GROUP_EDIT_COPY,
  monogramPlaceholder,
  newGroupBody,
  newGroupCopy,
  normalizeMonogram,
  roleLocked,
} from "@/lib/group-form";
import { GROUP_CARD_COPY } from "@/lib/group-page";
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

  it("tells a group with rules or a pause, and no devices, that its rules cannot apply yet", () => {
    expect(rulesNeedDevice({ internetRuleIds: [], suspension: { active: false, until: null } } as never)).toBe(false);
    expect(rulesNeedDevice({ internetRuleIds: ["r1"], suspension: { active: false, until: null } } as never)).toBe(true);
    expect(rulesNeedDevice({ internetRuleIds: [], suspension: { active: true, until: null } } as never)).toBe(true);
  });

  it("names an open card's Details link for its group", () => {
    expect(GROUP_CARD_COPY.detailsLabel("Sam")).toBe("Details for Sam");
  });

  it("heads a group's detail page with its role, or as a device group", () => {
    expect(groupDetailSub(group({ familyRole: "teen" }))).toBe("Teen");
    expect(groupDetailSub(group({ familyRole: null }))).toBe("Family member");
    expect(groupDetailSub(group({ kind: "things", familyRole: null }))).toBe("Device group");
  });
});

describe("the Edit sheet", () => {
  it("starts from the group, with its own endpoint shown in full", () => {
    expect(groupEditSheetDraft(group({ dohOverrideUrl: null }))).toMatchObject({ name: "Sam", familyRole: "child", doh: "default", url: "" });
    expect(groupEditSheetDraft(group({ dohOverrideUrl: "https://dns.nextdns.io/abc123" }))).toMatchObject({ doh: "custom", url: "https://dns.nextdns.io/abc123" });
    expect(GROUP_EDIT_COPY.title("Sam")).toBe("Edit Sam");
  });

  it("names what stops a save, in the design's words", () => {
    expect(groupEditError({ name: " ", doh: "default", url: "" })).toBe("Give it a name.");
    expect(groupEditError({ name: "Sam", doh: "default", url: "anything" })).toBeNull();
    expect(groupEditError({ name: "Sam", doh: "custom", url: "  " })).toBe("Paste an https:// endpoint, or use the household default.");
    expect(groupEditError({ name: "Sam", doh: "custom", url: "http://dns.example.com" })).toBe("The endpoint must start with https://");
    expect(groupEditError({ name: "Sam", doh: "custom", url: "https://" })).toBe("The endpoint must start with https://");
    expect(groupEditError({ name: "Sam", doh: "custom", url: " https://dns.example.com/q " })).toBeNull();
  });

  it("sends a resolver call only when the DNS choice changed", () => {
    const own = "https://dns.example.com/q";
    expect(groupResolverEdit(null, { doh: "default", url: "" })).toEqual({ kind: "none" });
    expect(groupResolverEdit(own, { doh: "default", url: own })).toEqual({ kind: "clear" });
    expect(groupResolverEdit(null, { doh: "custom", url: ` ${own} ` })).toEqual({ kind: "set", url: own });
    expect(groupResolverEdit(own, { doh: "custom", url: own })).toEqual({ kind: "none" });
    expect(groupResolverEdit(own, { doh: "custom", url: "https://other.example.com/q" })).toEqual({ kind: "set", url: "https://other.example.com/q" });
  });
});
