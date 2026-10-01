/**
 * Loading and changing DNS categories and the household resolver, as every client does. These are
 * reporting only: none creates a UniFi policy, so they go straight to the API rather than through the
 * household store, and a failure rejects with the server's message.
 */
import type { ApiRequest } from "./api-client";
import type { UpstreamCategoryRow, UpstreamResolverSettings } from "./upstream";

/** Every category, and the resolver when the server can describe one. */
export async function loadUpstreamCategories(request: ApiRequest) {
  const [categories, resolver] = await Promise.all([
    request<{ categories: UpstreamCategoryRow[] }>("/api/v1/upstream/categories"),
    request<{ resolver: UpstreamResolverSettings }>("/api/v1/upstream/resolver").catch(() => null),
  ]);
  return { categories: categories.categories, resolver: resolver?.resolver ?? null };
}

export function loadUpstreamCategory(request: ApiRequest, id: string) {
  return request<{ category: UpstreamCategoryRow }>(`/api/v1/upstream/categories/${id}`).then((res) => res.category);
}

/** Turn a category's automatic checks on or off; it never blocks or unblocks anything. */
export function setCategoryChecking(request: ApiRequest, category: Pick<UpstreamCategoryRow, "id">, enabled: boolean) {
  return request(`/api/v1/upstream/categories/${category.id}`, { method: "PATCH", body: { enabled } });
}

export function runAllChecks(request: ApiRequest) {
  return request("/api/v1/upstream/checks/run", { method: "POST" });
}

export function checkCategory(request: ApiRequest, category: Pick<UpstreamCategoryRow, "id">) {
  return request(`/api/v1/upstream/categories/${category.id}/check`, { method: "POST" });
}

/** Replace a category's active domains (`domainListAfter` in `upstream.ts` builds the list). */
export function patchCategoryDomains(request: ApiRequest, category: Pick<UpstreamCategoryRow, "id">, domains: string[]) {
  return request(`/api/v1/upstream/categories/${category.id}`, { method: "PATCH", body: { domains } });
}

export function deleteCategory(request: ApiRequest, category: Pick<UpstreamCategoryRow, "id">) {
  return request(`/api/v1/upstream/categories/${category.id}`, { method: "DELETE" });
}

/** A custom category: report-only by construction, with a typed monogram when one is given. */
export function createCategory(request: ApiRequest, label: string, monogram: string) {
  return request("/api/v1/upstream/categories", {
    method: "POST",
    body: { label: label.trim(), ...(monogram.trim() ? { monogram: monogram.trim() } : {}) },
  });
}

/** Change the resolver's endpoint, its checking, or its schedule. */
export function updateResolver(
  request: ApiRequest,
  patch: Partial<Pick<UpstreamResolverSettings, "url" | "probeEnabled" | "probeTime" | "probeDays">>,
) {
  return request("/api/v1/upstream/resolver", { method: "PUT", body: patch });
}

/** Save a pasted DNS-over-HTTPS endpoint and start checking against it. */
export function saveResolverUrl(request: ApiRequest, url: string) {
  return updateResolver(request, { url: url.trim(), probeEnabled: true });
}

export function clearResolver(request: ApiRequest) {
  return request("/api/v1/upstream/resolver", { method: "DELETE" });
}

/** Whether a pasted endpoint is long enough to save. */
export function canSaveResolverUrl(url: string): boolean {
  return url.trim().length > 8;
}

export const CATEGORIES_COPY = {
  title: "Categories",
  subtitle: "Domain lists checked against your resolver",
  newCategory: "New category",
  stance:
    "Domain-list categories, checked against the household’s own DNS resolver. Reporting only — FamilyFi never creates a policy from these. The switch only turns checking on or off, it never blocks or unblocks anything.",
  count: (count: number) => `${count} categories`,
  checkAll: "Check all now",
  checkingLabel: (label: string) => `Checking ${label}`,
  checkingTitle: "Only turns checking on or off — never blocks or unblocks anything",
  rowDetail: (domains: number, detail: string) => `${domains} domains · ${detail}`,
  loadFailed: "Could not load categories.",
  toggleFailed: "Could not change checking.",
  sweepFailed: "Could not run the checks.",
  detail: {
    back: "← Back to Categories",
    loading: "Loading…",
    loadFailed: "Could not load the category.",
    checkNow: "Check now",
    checkFailed: "Could not check the category.",
    checkingOn: "Checking on",
    checkingOff: "Checking off",
    deleteCategory: "Delete category",
    deleteFailed: "Could not delete the category.",
    domains: "Domains",
    restore: "Restore",
    remove: "Remove",
    restoreFailed: "Could not restore the domain.",
    removeFailed: "Could not remove the domain.",
    addLabel: "Add a domain",
    addPlaceholder: "Add a domain, e.g. example.com",
    add: "Add",
    addFailed: "Could not add the domain.",
    resultsByNetwork: "Results by network",
  },
  resolver: {
    title: "DNS resolver",
    dhcp: "Using DNS servers assigned by UniFi DHCP.",
    unavailable: "Resolver information is unavailable.",
    note: "Checks run from the FamilyFi host. A device on another VLAN may get a different answer. Turning checking off clears earlier results. Check now stays available.",
    schedule: "Check schedule",
    time: "Check time",
    endpoint: "DNS-over-HTTPS endpoint",
    placeholder: "https://dns.example.com/dns-query/profile",
    save: "Save",
    cancel: "Cancel",
    add: "Add DoH override",
    replace: "Replace DoH override",
    checkingOn: "Checking on",
    checkingOff: "Checking off",
    remove: "Remove",
    daysFailed: "Could not change the check days.",
    timeFailed: "Could not change the check time.",
    saveFailed: "Could not save the endpoint.",
    toggleFailed: "Could not change checking.",
    clearFailed: "Could not clear the endpoint.",
  },
  create: {
    title: "New category",
    body: "A domain list checked against DNS — reporting only, add domains afterward.",
    name: "Name",
    nameLabel: "Category name",
    namePlaceholder: "e.g. Gambling",
    monogram: "Monogram — up to 4 characters, e.g. GA, HW",
    monogramLabel: "Monogram",
    monogramPlaceholder: "e.g. GA",
    cancel: "Cancel",
    create: "Create category",
    failed: "Could not create the category.",
  },
} as const;

/** What deleting a custom category says before it goes, where a client asks. */
export function deleteCategoryCopy(category: Pick<UpstreamCategoryRow, "label">) {
  return {
    title: `Delete ${category.label}?`,
    message: "Its domains and check results are removed. Nothing is blocked or unblocked.",
    confirm: "Delete category",
  } as const;
}
