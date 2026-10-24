/**
 * The Block countries editor every client shows: the draft it edits, the country search, what it
 * checks before saving, what it sends, and its copy. The rule's name, kind and schedule are
 * FamilyFi's; only its switch, countries and what it applies to change, picked as for any rule.
 */
import { COUNTRIES, RECOMMENDED_BLOCKED_COUNTRIES, countriesSummary, countryName, type Country } from "./countries";
import type { HouseholdStore } from "./household-store";
import { appliesToBody, type AppliesTo } from "./rule-editor";
import type { Rule } from "./rules";
import type { Group } from "./types";

export type CountriesDraft = AppliesTo & { enabled: boolean; countries: string[] };

type SavedCountries = Pick<Rule, "enabled" | "countries" | "scope" | "groupIds" | "networkIds">;

/** The draft for the saved rule. A rule that covers no group yet starts with every group, as switching it on does. */
export function fromCountriesRule(rule: SavedCountries, groups: Pick<Group, "id">[]): CountriesDraft {
  return {
    enabled: rule.enabled,
    countries: [...rule.countries].sort(),
    scope: rule.scope,
    groupIds: rule.groupIds.length ? [...rule.groupIds].sort() : groups.map((group) => group.id).sort(),
    networkIds: [...rule.networkIds].sort(),
  };
}

export function toggleCountry(draft: CountriesDraft, code: string): CountriesDraft {
  const on = draft.countries.includes(code);
  return { ...draft, countries: on ? draft.countries.filter((item) => item !== code) : [...draft.countries, code].sort() };
}

/** Put the list back to the recommended countries. */
export function resetRecommendedCountries(draft: CountriesDraft): CountriesDraft {
  return { ...draft, countries: [...RECOMMENDED_BLOCKED_COUNTRIES].sort() };
}

/** Countries not yet picked whose name or code starts a word of the query, at most `limit`. */
export function searchCountries(query: string, picked: readonly string[], limit = 8): Country[] {
  const needle = query.trim().toLocaleLowerCase("en");
  if (!needle) return [];
  return COUNTRIES.filter(
    (country) =>
      !picked.includes(country.code) &&
      (country.code.toLowerCase() === needle || country.name.toLocaleLowerCase("en").split(/[\s&-]+/).some((word) => word.startsWith(needle)) || country.name.toLocaleLowerCase("en").startsWith(needle)),
  ).slice(0, limit);
}

/** The picked countries by name, the order the summary uses. */
export function pickedCountries(draft: Pick<CountriesDraft, "countries">): Country[] {
  return draft.countries.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Why the draft cannot be saved, or null. */
export function validateCountriesDraft(draft: CountriesDraft): string | null {
  if (draft.countries.length === 0) return COUNTRIES_EDITOR_COPY.countries.none;
  if (draft.scope === "group" && draft.groupIds.length === 0) return COUNTRIES_EDITOR_COPY.appliesTo.none;
  if (draft.scope === "network" && draft.networkIds.length === 0) return COUNTRIES_EDITOR_COPY.appliesTo.noNetwork;
  return null;
}

export function countriesEditorState(draft: CountriesDraft, saved: SavedCountries, groups: Pick<Group, "id">[]) {
  const before = fromCountriesRule(saved, groups);
  return {
    summary: `${draft.enabled ? "On" : "Off"} · ${countriesSummary(draft.countries)}`,
    dirty: JSON.stringify(sent(before)) !== JSON.stringify(sent(draft)),
  };
}

/** What saving sends: the switch, the countries, and what it applies to. */
function sent(draft: CountriesDraft) {
  return { enabled: draft.enabled, countries: [...draft.countries].sort(), ...appliesToBody(draft) };
}

type Mutate = HouseholdStore["mutate"];

/** Save the draft; resolves to the store's payload (with the saved `rule`), or undefined when it failed. */
export function saveCountriesRule(mutate: Mutate, draft: CountriesDraft, saved: Pick<Rule, "id">) {
  return mutate((send) => send<{ rule: Rule }>(`/api/v1/rules/${saved.id}`, { method: "PATCH", body: sent(draft) }), {
    feedback: { notice: "Block countries saved. FamilyFi writes it to the gateway next." },
  });
}

export const COUNTRIES_EDITOR_COPY = {
  title: "Block countries",
  save: "Save",
  unsaved: "Unsaved changes",
  status: {
    title: "Status",
    note: "When it’s on, one FamilyFi policy in UniFi stops the chosen groups’ devices reaching servers in these countries. Everything else stays on.",
    label: "Block countries",
  },
  countries: {
    title: "Countries",
    note: "UniFi matches each connection’s address to the country its server is in, not the country of the company behind it, so a big service served from a nearby data centre is not affected. Some games, apps and cameras use servers in China, so take it off the list if one stops working.",
    label: "Blocked countries",
    search: "Add a country",
    placeholder: "Search countries",
    recommended: "Reset to recommended",
    noMatch: "No country matches.",
    none: "Pick at least one country.",
  },
  appliesTo: {
    title: "Applies to",
    note: "Every group, Things too, unless you narrow it or pick whole networks. A new group joins while every group is on.",
    none: "Pick at least one person or thing the rule applies to.",
    noNetwork: "Pick at least one network.",
  },
} as const;
