"use client";

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FormField } from "./FormField";
import { PRESS_OPACITY, useUI } from "./UIContext";

/** One of the group Edit sheet's controls under its label, with the note that explains it. */
export function EditField({ label, note, children }: { label: string; /** The control is a set of choices, not one field. */ group?: boolean; note?: string; children: ReactNode }) {
  const ui = useUI();
  return (
    <View style={styles.field}>
      <FormField label={label}>{children}</FormField>
      {note ? <Text style={[styles.note, { fontFamily: ui.font, color: ui.color("muted") }]}>{note}</Text> : null}
    </View>
  );
}

/**
 * What a group's Block button stands for. The app draws the choices as rows with a checkmark on
 * the one chosen, as its settings do; the web's is a select (`GroupEditFields.web.tsx`).
 */
export function BlockButtonField({
  label,
  help,
  choices,
  value,
  onChange,
  disabled,
}: {
  label: string;
  help: string;
  choices: readonly { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const ui = useUI();
  return (
    <View style={styles.field}>
      <FormField label={label}>
        <View role="radiogroup" aria-label={label} style={[styles.choices, { backgroundColor: ui.color("field-soft"), borderColor: ui.color("control-line") }]} testID="group-block-button">
          {choices.map((choice, index) => {
            const chosen = choice.value === value;
            return (
              <Pressable
                key={choice.value}
                role="radio"
                aria-checked={chosen}
                aria-disabled={disabled}
                disabled={disabled}
                onPress={() => onChange(choice.value)}
                testID={`group-block-button-${choice.value || "all"}`}
                style={({ pressed }) => [
                  styles.choice,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ui.color("hairline") },
                  disabled ? styles.disabled : pressed && { opacity: PRESS_OPACITY },
                ]}
              >
                <Text style={[styles.choiceLabel, { fontFamily: ui.font, color: ui.color("ink") }]}>{choice.label}</Text>
                {chosen ? <ui.Icon name="check" size={18} color={ui.color("accent")} /> : null}
              </Pressable>
            );
          })}
        </View>
      </FormField>
      <Text style={[styles.note, { fontFamily: ui.font, color: ui.color("ink-2") }]}>{help}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  note: { fontSize: 14, lineHeight: 20 },
  choices: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 7, overflow: "hidden" },
  choice: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, paddingHorizontal: 12, gap: 8 },
  choiceLabel: { flexShrink: 1, fontSize: 16, lineHeight: 24, paddingVertical: 10 },
  disabled: { opacity: 0.4 },
});
