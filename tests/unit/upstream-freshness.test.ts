import { expect, it } from "vitest";
import { checkIsFresh } from "@/server/upstream-categories";

it("stops presenting a check after seven days", () => {
  const now = new Date("2026-09-27T12:00:00.000Z");
  expect(checkIsFresh({ checkedAt: new Date("2026-09-20T12:00:00.000Z") }, now)).toBe(true);
  expect(checkIsFresh({ checkedAt: new Date("2026-09-20T11:59:59.999Z") }, now)).toBe(false);
});
