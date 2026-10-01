import { describe, expect, it } from "vitest";
import { formatHhmm } from "@/lib/display";
import { categoryCheckLine, domainListAfter, probeScheduleWhen, resolverScheduleLine, toggleProbeDay, type UpstreamCheckRow } from "@/lib/upstream";
import {
  canSaveResolverUrl,
  checkCategory,
  clearResolver,
  createCategory,
  deleteCategory,
  deleteCategoryCopy,
  loadUpstreamCategories,
  loadUpstreamCategory,
  patchCategoryDomains,
  runAllChecks,
  saveResolverUrl,
  setCategoryChecking,
  updateResolver,
} from "@/lib/upstream-writes";

function recorder(answer: (path: string) => unknown = () => ({})) {
  const sent: { path: string; method?: string; body?: unknown }[] = [];
  const request = async <T,>(path: string, init?: { method?: string; body?: unknown }) => {
    sent.push({ path, ...init });
    const value = answer(path);
    if (value instanceof Error) throw value;
    return value as T;
  };
  return { request, sent };
}

describe("loading categories", () => {
  it("loads every category with the resolver, and carries on without a resolver", async () => {
    const both = recorder((path) => (path.endsWith("/categories") ? { categories: [{ id: "c1" }] } : { resolver: { url: null } }));
    expect(await loadUpstreamCategories(both.request)).toEqual({ categories: [{ id: "c1" }], resolver: { url: null } });
    const noResolver = recorder((path) => (path.endsWith("/categories") ? { categories: [] } : new Error("unavailable")));
    expect(await loadUpstreamCategories(noResolver.request)).toEqual({ categories: [], resolver: null });
    const failed = recorder(() => new Error("Could not reach FamilyFi"));
    await expect(loadUpstreamCategories(failed.request)).rejects.toThrow("Could not reach FamilyFi");
  });

  it("loads one category", async () => {
    const { request, sent } = recorder(() => ({ category: { id: "c1" } }));
    expect(await loadUpstreamCategory(request, "c1")).toEqual({ id: "c1" });
    expect(sent).toEqual([{ path: "/api/v1/upstream/categories/c1" }]);
  });
});

describe("category and resolver writes", () => {
  it("sends each write's request", async () => {
    const { request, sent } = recorder();
    const category = { id: "c1" };
    await setCategoryChecking(request, category, false);
    await runAllChecks(request);
    await checkCategory(request, category);
    await patchCategoryDomains(request, category, ["a.com"]);
    await deleteCategory(request, category);
    await createCategory(request, " Gambling ", " GA ");
    await createCategory(request, "Gambling", "  ");
    await updateResolver(request, { probeDays: [1, 2] });
    await saveResolverUrl(request, " https://dns.example/q ");
    await clearResolver(request);
    expect(sent).toEqual([
      { path: "/api/v1/upstream/categories/c1", method: "PATCH", body: { enabled: false } },
      { path: "/api/v1/upstream/checks/run", method: "POST" },
      { path: "/api/v1/upstream/categories/c1/check", method: "POST" },
      { path: "/api/v1/upstream/categories/c1", method: "PATCH", body: { domains: ["a.com"] } },
      { path: "/api/v1/upstream/categories/c1", method: "DELETE" },
      { path: "/api/v1/upstream/categories", method: "POST", body: { label: "Gambling", monogram: "GA" } },
      { path: "/api/v1/upstream/categories", method: "POST", body: { label: "Gambling" } },
      { path: "/api/v1/upstream/resolver", method: "PUT", body: { probeDays: [1, 2] } },
      { path: "/api/v1/upstream/resolver", method: "PUT", body: { url: "https://dns.example/q", probeEnabled: true } },
      { path: "/api/v1/upstream/resolver", method: "DELETE" },
    ]);
  });

  it("saves an endpoint only once it is long enough", () => {
    expect(canSaveResolverUrl(" https:/ ")).toBe(false);
    expect(canSaveResolverUrl("https://a")).toBe(true);
  });

  it("asks before deleting a custom category, where a client asks", () => {
    expect(deleteCategoryCopy({ label: "Gambling" }).title).toBe("Delete Gambling?");
  });
});

describe("category lines", () => {
  const resolver = { probeEnabled: true, probeDays: [1, 2, 3, 4, 5], probeTime: "03:00", nextRunAt: null };
  const now = new Date("2026-03-04T15:00:00Z");

  it("says when checks run, and when they run next", () => {
    expect(resolverScheduleLine({ ...resolver, probeEnabled: false }, "UTC", now)).toBe("Paused — last results kept");
    expect(resolverScheduleLine({ ...resolver, probeDays: [] }, "UTC", now)).toBe("No days selected — checking won't run");
    expect(resolverScheduleLine(resolver, "UTC", now)).toBe(`Weekdays at ${formatHhmm("03:00")}`);
    expect(resolverScheduleLine({ ...resolver, nextRunAt: "2026-03-05T03:00:00Z" }, "UTC", now)).toBe(
      `${probeScheduleWhen(resolver.probeDays)} at ${formatHhmm("03:00")} · next tomorrow`,
    );
  });

  it("turns a check day on or off, in order", () => {
    expect(toggleProbeDay([1, 5], 3)).toEqual([1, 3, 5]);
    expect(toggleProbeDay([1, 3, 5], 3)).toEqual([1, 5]);
  });

  it("says where a check was measured, what it found and how long ago", () => {
    const check = { verdict: "blocked", blockedCount: 3, totalCount: 3, checkedAt: "2026-03-04T14:55:00Z", source: "doh" } as UpstreamCheckRow;
    expect(categoryCheckLine(check, now.getTime())).toBe("DoH override · 3 of 3 test domains blocked · checked 5m ago");
    expect(categoryCheckLine({ ...check, source: "dhcp" }, now.getTime())).toMatch(/^UniFi DHCP · /);
    expect(categoryCheckLine(null)).toBe("Not checked yet");
  });

  it("restores a removed domain or removes an active one from the list it sends", () => {
    expect(domainListAfter(["a.com", "b.com"], { domain: "c.com", removed: true })).toEqual(["a.com", "b.com", "c.com"]);
    expect(domainListAfter(["a.com", "b.com"], { domain: "a.com", removed: false })).toEqual(["b.com"]);
  });
});
