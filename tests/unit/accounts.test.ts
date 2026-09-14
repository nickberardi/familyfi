import { FamilyRole, GroupKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertAdultFamilyGroup, assertPersonalUsername, normalizeUsername } from "@/server/accounts";

describe("accounts", () => {
  it("reserves admin and normalizes usernames", () => {
    expect(normalizeUsername(" Nick ")).toBe("nick");
    expect(() => assertPersonalUsername("admin")).toThrow(/reserved/);
    expect(() => assertPersonalUsername("ok")).not.toThrow();
  });

  it("allows only adult Family groups", () => {
    expect(() =>
      assertAdultFamilyGroup({ kind: GroupKind.family, familyRole: FamilyRole.adult }),
    ).not.toThrow();
    expect(() =>
      assertAdultFamilyGroup({ kind: GroupKind.family, familyRole: FamilyRole.child }),
    ).toThrow(/cannot log in/);
    expect(() => assertAdultFamilyGroup({ kind: GroupKind.things, familyRole: null })).toThrow(/cannot log in/);
  });
});
