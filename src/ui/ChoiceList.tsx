import { Pressable, StyleSheet, Text, View } from "react-native";

import { PRESS_OPACITY, useUI, type UISegmentedProps } from "./UIContext";

/**
 * A segmented control's choices as a list, one row each with the chosen one checked, for the apps
 * at large text (`useLargeText`): a platform segmented control keeps its labels small, and three of
 * them can't share a row at that size. Each app's `Segmented` switches to it from `STACK_AT`. Drawn as
 * the Block button default's choices (`GroupEditFields`).
 */
export function ChoiceList<T extends string>({
  name,
  value,
  segments,
  onChange,
  disabled,
  testID,
}: UISegmentedProps<T>) {
  const { color, Icon, font } = useUI();
  return (
    <View
      role="radiogroup"
      aria-label={name}
      style={[styles.list, { backgroundColor: color("field-soft"), borderColor: color("control-line") }]}
      testID={testID}
    >
      {segments.map((segment, index) => {
        const selected = segment.value === value;
        const off = disabled || segment.disabled;
        return (
          <Pressable
            key={segment.value}
            role="radio"
            aria-checked={selected}
            aria-disabled={off}
            disabled={off}
            onPress={() => onChange(segment.value)}
            style={({ pressed }) => [
              styles.row,
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color("hairline") },
              (pressed || off) && { opacity: PRESS_OPACITY },
            ]}
            testID={testID ? `${testID}-${segment.value}` : undefined}
          >
            <Text style={[styles.label, { fontFamily: font, color: color("ink") }]}>{segment.label}</Text>
            {selected ? <Icon name="check" size={20} color={color("accent")} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1.5, borderRadius: 7, overflow: "hidden" },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: { flex: 1, fontSize: 16 },
});
