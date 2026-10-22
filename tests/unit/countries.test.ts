import { describe, expect, it } from "vitest";
import { COUNTRIES, RECOMMENDED_BLOCKED_COUNTRIES, countriesSummary, countryName, isCountryCode } from "@/lib/countries";
import { fromCountriesRule, resetRecommendedCountries, searchCountries, toggleCountriesGroup, toggleCountry, validateCountriesDraft } from "@/lib/countries-editor";
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
    const draft = fromCountriesRule({ enabled: false, countries: ["RU", "KP"], groupIds: [] }, groups);
    // A rule that covers no group yet starts with every group, as switching it on does.
    expect(draft).toEqual({ enabled: false, countries: ["KP", "RU"], groupIds: ["a", "b"] });
    expect(toggleCountry(draft, "KP").countries).toEqual(["RU"]);
    expect(toggleCountry(draft, "FR").countries).toEqual(["FR", "KP", "RU"]);
    expect(toggleCountriesGroup(draft, "a").groupIds).toEqual(["b"]);
    expect(resetRecommendedCountries({ ...draft, countries: ["FR"] }).countries).toEqual([...RECOMMENDED_BLOCKED_COUNTRIES].sort());
    expect(validateCountriesDraft({ ...draft, countries: [] })).toBe("Pick at least one country.");
    expect(validateCountriesDraft({ ...draft, groupIds: [] })).toBe("Pick at least one person or thing the rule applies to.");
    expect(validateCountriesDraft(draft)).toBeNull();
  });

  it("searches by a word of the name or the code, leaving out the picked ones", () => {
    expect(searchCountries("korea", []).map((country) => country.code)).toEqual(["KP", "KR"]);
    expect(searchCountries("korea", ["KP"]).map((country) => country.code)).toEqual(["KR"]);
    expect(searchCountries("united s", []).map((country) => country.code)).toContain("US");
    expect(searchCountries("de", []).map((country) => country.code)).toContain("DE");
    expect(searchCountries("  ", [])).toEqual([]);
  });
});
