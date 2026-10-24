"use client";

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  COUNTRIES_EDITOR_COPY as COPY,
  resetRecommendedCountries,
  pickedCountries,
  searchCountries,
  toggleCountry,
  type CountriesDraft,
} from "@/lib/countries-editor";
import type { Group } from "@/lib/types";

import { Chip, ChipGroup } from "./Chips";
import { EditorSection } from "./EditorSection";
import { RuleAppliesTo } from "./RuleAppliesTo";
import { PRESS_OPACITY, useUI } from "./UIContext";

type Edit = (next: (draft: CountriesDraft) => CountriesDraft) => void;

/**
 * The Block countries editor's form, shared by every client: its switch, the countries it blocks,
 * and what it applies to, picked as for any rule. Each client wraps it in its own page or sheet with the save action.
 */
export function CountriesRuleForm({
  draft,
  groups,
  networks,
  error,
  disabled = false,
  edit,
}: {
  draft: CountriesDraft;
  groups: Pick<Group, "id" | "name">[];
  /** The networks FamilyFi manages (`managedNetworks`), which it can cover whole. */
  networks: { id: string; name: string }[];
  error: string;
  disabled?: boolean;
  edit: Edit;
}) {
  const ui = useUI();
  const [query, setQuery] = useState("");
  const matches = searchCountries(query, draft.countries);
  const note = { fontFamily: ui.font, fontSize: 14, lineHeight: 20, color: ui.color("ink-2") };

  function add(code: string) {
    edit((current) => toggleCountry(current, code));
    setQuery("");
  }

  return (
    <View style={styles.form}>
      {error ? (
        <Text role="alert" style={[note, styles.error, { backgroundColor: ui.color("danger-fill"), color: ui.color("danger") }]} testID="countries-error">
          {error}
        </Text>
      ) : null}

      <EditorSection title={COPY.status.title} note={COPY.status.note}>
        <View style={styles.row}>
          <Text style={[styles.label, { fontFamily: ui.font, color: ui.color("ink") }]}>{COPY.status.label}</Text>
          <ui.Toggle label={COPY.status.label} on={draft.enabled} onToggle={() => edit((current) => ({ ...current, enabled: !current.enabled }))} disabled={disabled} testID="countries-enabled" />
        </View>
      </EditorSection>

      <EditorSection title={COPY.countries.title} note={COPY.countries.note}>
        <ChipGroup label={COPY.countries.label}>
          {pickedCountries(draft).map((country) => (
            <Chip key={country.code} on onPress={() => edit((current) => toggleCountry(current, country.code))} disabled={disabled} testID={`countries-picked-${country.code}`}>
              {country.name}
            </Chip>
          ))}
        </ChipGroup>
        <ui.TextField
          label={COPY.countries.search}
          value={query}
          onChange={setQuery}
          onSubmit={() => matches[0] && add(matches[0].code)}
          placeholder={COPY.countries.placeholder}
          disabled={disabled}
          testID="countries-search"
        />
        {query.trim() ? (
          matches.length ? (
            <ChipGroup label={COPY.countries.search}>
              {matches.map((country) => (
                <Chip key={country.code} on={false} onPress={() => add(country.code)} disabled={disabled} testID={`countries-add-${country.code}`}>
                  {country.name}
                </Chip>
              ))}
            </ChipGroup>
          ) : (
            <Text style={note}>{COPY.countries.noMatch}</Text>
          )
        ) : null}
        <Pressable
          role="button"
          aria-disabled={disabled}
          disabled={disabled}
          onPress={() => edit(resetRecommendedCountries)}
          testID="countries-recommended"
          style={({ pressed }) => [styles.textButton, disabled && { opacity: 0.5 }, pressed && !disabled && { opacity: PRESS_OPACITY }]}
        >
          <Text style={[styles.label, { fontFamily: ui.font, color: ui.color("accent") }]}>{COPY.countries.recommended}</Text>
        </Pressable>
      </EditorSection>

      <RuleAppliesTo draft={draft} groups={groups} networks={networks} edit={edit} note={COPY.appliesTo.note} disabled={disabled} testID="countries" />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  error: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  label: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
  textButton: { alignSelf: "flex-start" },
});
