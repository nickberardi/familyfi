import { describe, expect, it } from "vitest";
import { shareUnchanged } from "@/lib/structural-sharing";

describe("shareUnchanged", () => {
  it("returns the previous value when the next has the same content", () => {
    const previous = { groups: [{ id: "a", tags: ["x"] }], count: 1, note: null };
    const next = JSON.parse(JSON.stringify(previous)) as typeof previous;
    expect(shareUnchanged(previous, next)).toBe(previous);
  });

  it("keeps unchanged items and builds new containers only along what changed", () => {
    const previous = [{ id: "a", access: "available", by: { name: "An adult" } }, { id: "b", access: "available", by: null }];
    const next = [{ id: "a", access: "paused", by: { name: "An adult" } }, { id: "b", access: "available", by: null }];
    const shared = shareUnchanged(previous, next);
    expect(shared).toEqual(next);
    expect(shared).not.toBe(previous);
    expect(shared[0]).not.toBe(previous[0]);
    expect(shared[0]!.by).toBe(previous[0]!.by);
    expect(shared[1]).toBe(previous[1]);
  });

  it("notices added, removed and renamed keys and items", () => {
    expect(shareUnchanged([1, 2], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(shareUnchanged([1, 2, 3], [1, 2])).toEqual([1, 2]);
    const previous = { a: 1, b: 2 };
    expect(shareUnchanged(previous, { a: 1 } as typeof previous)).toEqual({ a: 1 });
    expect(shareUnchanged(previous, { a: 1, c: 2 } as unknown as typeof previous)).toEqual({ a: 1, c: 2 });
    expect(shareUnchanged<unknown>({ a: undefined }, { b: undefined })).toEqual({ b: undefined });
  });

  it("takes the next value when the shapes differ", () => {
    expect(shareUnchanged<unknown>([1], { 0: 1 })).toEqual({ 0: 1 });
    expect(shareUnchanged<unknown>(null, { a: 1 })).toEqual({ a: 1 });
    expect(shareUnchanged<unknown>({ a: 1 }, null)).toBeNull();
    expect(shareUnchanged("a", "b")).toBe("b");
    const date = new Date(0);
    expect(shareUnchanged<unknown>(new Date(0), date)).toBe(date);
  });
});
