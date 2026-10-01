import { describe, expect, it, vi } from "vitest";
import type { CategorySheetState } from "@/lib/category-marks";
import { applyFilterAction, filterSheetCopy } from "@/lib/filter-sheet";
import type { Rule } from "@/lib/rules";

const group = { id: "g1", name: "A child" };
const category = (over: Partial<Extract<CategorySheetState, { kind: "category" }>> = {}): CategorySheetState => ({
  kind: "category",
  name: "Video",
  categoryId: 7,
  domains: [],
  rule: undefined,
  upstream: null,
  activelyBlocking: false,
  ...over,
});
const rule = (over: Partial<Rule> = {}) => ({ id: "r1", name: "Video for A child", enabled: true, groupIds: ["g1"], mode: "always", windows: [], ...over }) as Rule;

describe("filter sheet", () => {
  it("offers a policy when nothing blocks a category", () => {
    expect(filterSheetCopy(group, category())).toMatchObject({
      heading: "Nothing's blocking Video yet",
      action: "create",
      actionLabel: "Create policy",
      editLabel: "Schedule it instead",
    });
  });

  it("turns off a blocking rule, and warns when it covers other groups", () => {
    const copy = filterSheetCopy(group, category({ rule: rule({ groupIds: ["g1", "g2"] }), activelyBlocking: true }));
    expect(copy).toMatchObject({ heading: "Video · blocked", action: "turnOff", actionLabel: "Turn off", editLabel: "Edit rule and schedule" });
    expect(copy.body).toContain("for every group it covers");
  });

  it("says a scheduled rule is idle outside its windows, and lists them", () => {
    const windows = [{ id: "w1", name: "School", start: "08:00", end: "15:00", days: [1, 2, 3, 4, 5] }];
    const copy = filterSheetCopy(group, category({ rule: rule({ mode: "scheduled", windows } as Partial<Rule>) }));
    expect(copy.heading).toBe("Video · scheduled, not now");
    expect(copy.action).toBe("turnOff");
    expect(copy.windows).toHaveLength(1);
    expect(copy.windows[0]).toMatch(/^School · /);
  });

  it("reports the resolver's verdict when FamilyFi is not blocking", () => {
    const upstream = { verdict: "partial", blockedCount: 2, totalCount: 5, checkedAt: new Date(0).toISOString() };
    const copy = filterSheetCopy(group, category({ upstream } as Partial<CategorySheetState> as never), 60 * 60_000);
    expect(copy.heading).toBe("Partially blocked (DNS)");
    expect(copy.body).toContain("blocks 2 of 5 Video domains we test. Checked 1h ago.");
  });

  it("links to a Websites rule for a category UniFi cannot block", () => {
    const copy = filterSheetCopy(group, category({ categoryId: null, domains: ["a.example", "b.example"] }));
    expect(copy).toMatchObject({ action: "websites", actionLabel: "Block its websites" });
    expect(copy.body).toContain("the 2 websites this category checks");
  });

  it("sends each action's request", async () => {
    const send = vi.fn(async () => ({}));
    const mutate = (run: (request: typeof send) => Promise<unknown>) => run(send);
    await applyFilterAction(mutate as never, group, category(), "create");
    expect(send).toHaveBeenLastCalledWith("/api/v1/rules", {
      method: "POST",
      body: { name: "Video for A child", kind: "category", scope: "group", groupIds: ["g1"], targetIds: [7], mode: "always" },
    });
    await applyFilterAction(mutate as never, group, category({ rule: rule() }), "turnOff");
    expect(send).toHaveBeenLastCalledWith("/api/v1/rules/r1/off", { method: "POST", body: {} });
    await applyFilterAction(mutate as never, group, category({ rule: rule({ enabled: false }) }), "enable");
    expect(send).toHaveBeenLastCalledWith("/api/v1/rules/r1", { method: "PATCH", body: { enabled: true } });
    await expect(applyFilterAction(mutate as never, group, category({ categoryId: null }), "create")).rejects.toThrow("Nothing to create.");
  });
});
