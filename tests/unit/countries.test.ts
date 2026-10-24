import { describe, expect, it } from "vitest";
import { COUNTRIES, RECOMMENDED_BLOCKED_COUNTRIES, countriesSummary, countryName, isCountryCode } from "@/lib/countries";
import { countriesEditorState, fromCountriesRule, resetRecommendedCountries, searchCountries, toggleCountry, validateCountriesDraft } from "@/lib/countries-editor";
import { toggleRuleGroup } from "@/lib/rule-editor";
import { ruleBlocksLabel } from "@/lib/rules";

describe("countries", () => {
  it("lists each UniFi region code once, by name", () => {
    expect(new Set(COUNTRIES.map((country) => country.code)).size).toBe(COUNTRIES.length);
    expect(COUNTRIES.every((country) => /^[A-Z]{2}$/.test(country.code))).toBe(true);
    expect(RECOMMENDED_BLOCKED_COUNTRIES.every(isCountryCode)).toBe(true);
    expect(isCountryCode("ZZ")).toBe(false);
    expect(countryName("KP")).toBe("North Korea");
  });

  it("names the countries a parent recognises first", () => {
    expect(countriesSummary([...RECOMMENDED_BLOCKED_COUNTRIES])).toBe("North Korea, Iran, China and 3 more");
    expect(countriesSummary(["FR", "CU"])).toBe("Cuba and France");
    expect(countriesSummary([])).toBe("No countries");
    expect(ruleBlocksLabel({ kind: "domain", targetIds: [], domains: [], builtIn: "countries", countries: ["KP"] }, new Map())).toBe("North Korea · everything else stays on");
  });

  it("edits a Block countries draft", () => {
    const groups = [{ id: "a" }, { id: "b" }];
    // As the server sends it: a group rule carries no networkIds.
    const saved = { enabled: false, countries: ["RU", "KP"], scope: "group" as const, groupIds: [] };
    const draft = fromCountriesRule(saved, groups);
    // A rule that covers no group yet starts with every group, as switching it on does.
    expect(draft).toEqual({ enabled: false, countries: ["KP", "RU"], scope: "group", groupIds: ["a", "b"], networkIds: [] });
    expect(toggleCountry(draft, "KP").countries).toEqual(["RU"]);
    expect(toggleCountry(draft, "FR").countries).toEqual(["FR", "KP", "RU"]);
    expect(toggleRuleGroup(draft, "a").groupIds).toEqual(["b"]);
    expect(resetRecommendedCountries({ ...draft, countries: ["FR"] }).countries).toEqual([...RECOMMENDED_BLOCKED_COUNTRIES].sort());
    expect(validateCountriesDraft({ ...draft, countries: [] })).toBe("Pick at least one country.");
    expect(validateCountriesDraft({ ...draft, groupIds: [] })).toBe("Pick at least one person or thing the rule applies to.");
    expect(validateCountriesDraft(draft)).toBeNull();
  });

  it("applies to whole networks like any rule", () => {
    const groups = [{ id: "a" }];
    const saved = { enabled: true, countries: ["KP"], scope: "group" as const, groupIds: ["a"], networkIds: [] };
    const draft = { ...fromCountriesRule(saved, groups), scope: "network" as const };
    expect(validateCountriesDraft(draft)).toBe("Pick at least one network.");
    expect(validateCountriesDraft({ ...draft, networkIds: ["lan"] })).toBeNull();
    expect(countriesEditorState(draft, saved, groups).dirty).toBe(true);
    // The other scope's picks are kept while editing, and never count as a change.
    expect(countriesEditorState({ ...fromCountriesRule(saved, groups), networkIds: ["lan"] }, saved, groups).dirty).toBe(false);
    // A rule on networks carries no groupIds.
    const onNetworks = { enabled: true, countries: ["KP"], scope: "network" as const, networkIds: ["lan"] };
    expect(fromCountriesRule(onNetworks, groups)).toMatchObject({ scope: "network", networkIds: ["lan"] });
  });

  it("searches by a word of the name or the code, leaving out the picked ones", () => {
    expect(searchCountries("korea", []).map((country) => country.code)).toEqual(["KP", "KR"]);
    expect(searchCountries("korea", ["KP"]).map((country) => country.code)).toEqual(["KR"]);
    expect(searchCountries("united s", []).map((country) => country.code)).toContain("US");
    expect(searchCountries("de", []).map((country) => country.code)).toContain("DE");
    expect(searchCountries("  ", [])).toEqual([]);
  });
});
