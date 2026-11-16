"use client";

import {
  SETUP_ACTIONS,
  SETUP_PROGRESS,
  type SetupProgressStep,
} from "@/lib/companion-setup";

import { Button } from "./Button";
import { paletteColor } from "./palette";
import { UIProvider, useUI } from "./UIContext";
import { useMemo, type ComponentProps, type ReactNode } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

/**
 * A phone's setup step, shared by the FamilyFi app and FamilyFi Me so pairing looks the same in
 * both: always on the brand's deep ground, whatever the phone's appearance, under a header with
 * Back and the setup's progress (familyfi-ios's `SetupFlowView`). A step's content sits in a column
 * up to 420 wide; Welcome (`centered`) stands in the middle of the screen. The system bars' insets
 * come from the app's `UI` (`safeInsets`); each app supplies its own words.
 */
export function SetupScreen({
  step,
  title,
  body,
  dense = false,
  onBack,
  centered = false,
  footer,
  children,
  testID,
}: {
  step: SetupProgressStep;
  title?: string;
  body?: string;
  /** The smaller body text of the paste step. */
  dense?: boolean;
  onBack?: () => void;
  /** Welcome: the content centred on the screen, `footer` at the bottom. */
  centered?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
  testID?: string;
}) {
  const insets = useUI().safeInsets ?? { top: 0, bottom: 0 };
  const heading = title ? (
    <View style={[styles.heading, centered && styles.centeredHeading]}>
      <Text
        accessibilityRole="header"
        style={[
          centered ? styles.welcomeTitle : styles.title,
          centered && styles.center,
        ]}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={[
            dense ? styles.dense : styles.body,
            centered && [styles.center, styles.welcomeBody],
          ]}
        >
          {body}
        </Text>
      ) : null}
    </View>
  ) : null;
  return (
    <View style={styles.page} testID={testID}>
      <SetupHeader step={step} onBack={onBack} top={insets.top} />
      <ScrollView
        style={styles.page}
        contentContainerStyle={[
          styles.content,
          centered && styles.centeredContent,
          { paddingBottom: insets.bottom + (centered ? 20 : 24) },
        ]}
        keyboardShouldPersistTaps="handled"
        // iOS keeps the step's button above the keyboard; on Android the keyboard's own action key submits.
        automaticallyAdjustKeyboardInsets
      >
        {centered ? (
          <View style={styles.welcome}>
            <View style={styles.welcomeMiddle}>
              {children}
              {heading}
            </View>
            <View style={styles.column}>{footer}</View>
          </View>
        ) : (
          <View style={[styles.column, styles.step]}>
            {heading}
            {children}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** Back (while there is somewhere to go back to) and the four capsules of the setup's progress. */
function SetupHeader({
  step,
  onBack,
  top,
}: {
  step: SetupProgressStep;
  onBack?: () => void;
  top: number;
}) {
  const ui = useUI();
  const index = SETUP_PROGRESS.indexOf(step);
  return (
    <View style={[styles.header, { paddingTop: top + 20 }]}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={SETUP_ACTIONS.back}
          onPress={onBack}
          testID="setup-back"
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
        >
          <ui.Icon name="caret-left" size={15} color={SETUP.ink} />
          <Text style={[styles.body, { color: SETUP.ink }]}>
            {SETUP_ACTIONS.back}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.spacer} />
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Setup progress"
        accessibilityValue={{
          min: 1,
          max: SETUP_PROGRESS.length,
          now: index + 1,
          text: `Step ${index + 1} of ${SETUP_PROGRESS.length}`,
        }}
        style={styles.progress}
      >
        {SETUP_PROGRESS.map((name, at) => (
          <View
            key={name}
            style={[
              styles.pip,
              { backgroundColor: at <= index ? SETUP.accent : SETUP.track },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * A setup action, as familyfi-ios draws it: `primary` a filled capsule (Scan, Pair, Trust),
 * grey while disabled; `tinted` (familyfi's `secondary`) a cyan-washed capsule (Paste the code instead); `plain` leading text
 * in cyan (Not my household, Pair a different phone), or centred white where `tone` says (Welcome's
 * Paste).
 */
export function SetupButton({
  tone = "cyan",
  ...props
}: ComponentProps<typeof Button> & { tone?: "cyan" | "white" }) {
  const ui = useUI();
  const kind = props.kind ?? "primary";
  const grey = kind === "primary" && (props.disabled || props.busy);
  const brand = useMemo(() => {
    const tokens: Record<string, string> =
      kind === "primary"
        ? {
            accent: grey ? SETUP.disabled : SETUP.button,
            "ink-on-fill": grey ? SETUP.disabledInk : SETUP.ink,
          }
        : {
            accent: tone === "white" ? SETUP.ink : SETUP.accent,
            // familyfi's `secondary` (once `tinted`): cyan text on the cyan wash, without the web's
            // hairline, as familyfi-ios's capsule.
            "accent-hover": SETUP.accent,
            "accent-fill": SETUP.tint,
            "accent-line": "transparent",
            ink: SETUP.ink,
            line: SETUP.ink2,
          };
    return {
      ...ui,
      color: (token: string) => tokens[token] ?? ui.color(token),
    };
  }, [ui, kind, grey, tone]);
  const plain = kind === "plain";
  const leading = plain && tone === "cyan";
  return (
    <UIProvider value={brand}>
      <Button
        {...props}
        style={[
          plain ? styles.plain : styles.capsule,
          leading && styles.leading,
          grey && styles.greyed,
        ]}
        labelStyle={
          plain
            ? leading
              ? styles.plainLabel
              : styles.actionLabel
            : styles.capsuleLabel
        }
      />
    </UIProvider>
  );
}

/** A labelled field on the deep ground: the label muted, the field white, as familyfi-ios's setup sets them. */
export function SetupField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.fieldBox}>{children}</View>
    </View>
  );
}

/** familyfi's brand tokens for setup, which do not change with the appearance. */
export const SETUP = {
  page: paletteColor("light", "brand-deep"),
  ink: paletteColor("light", "brand-on-deep"),
  ink2: paletteColor("light", "brand-on-deep-2"),
  accent: paletteColor("light", "brand-cyan"),
  button: paletteColor("light", "accent"),
  danger: paletteColor("dark", "danger"),
  track: paletteColor("light", "brand-setup-track"),
  disabled: paletteColor("light", "brand-setup-disabled"),
  disabledInk: paletteColor("light", "brand-setup-disabled-ink"),
  tint: paletteColor("light", "brand-setup-tint"),
  well: paletteColor("light", "brand-setup-well"),
  field: paletteColor("light", "brand-setup-field"),
  mono: Platform.select({ ios: "Menlo", default: "monospace" }),
};

/** Sizes from familyfi-ios's type scale (`Typography.swift`): body 14, dense 12.5, label 12. */
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: SETUP.page },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: 20,
    gap: 10,
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
    paddingRight: 8,
  },
  spacer: { flex: 1 },
  progress: {
    flexDirection: "row",
    gap: 5,
    minHeight: 44,
    alignItems: "center",
  },
  pip: { width: 18, height: 5, borderRadius: 2.5 },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24 },
  centeredContent: { paddingTop: 0 },
  column: { width: "100%", maxWidth: 420, alignSelf: "center" },
  step: { gap: 18 },
  heading: { gap: 12 },
  centeredHeading: { gap: 8, alignItems: "center" },
  welcome: { flex: 1, width: "100%", gap: 32 },
  welcomeMiddle: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 26,
    paddingTop: 32,
  },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700", color: SETUP.ink },
  welcomeTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700",
    color: SETUP.ink,
  },
  body: { fontSize: 14, lineHeight: 20, color: SETUP.ink2 },
  dense: { fontSize: 12.5, lineHeight: 18, color: SETUP.ink2 },
  welcomeBody: { maxWidth: 300 },
  center: { textAlign: "center" },
  field: { gap: 6 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: SETUP.ink2 },
  fieldBox: {
    backgroundColor: SETUP.field,
    borderRadius: 7,
    padding: 10,
    minHeight: 44,
    justifyContent: "center",
  },
  capsule: { borderRadius: 999, borderWidth: 0, minHeight: 50 },
  capsuleLabel: { fontWeight: "400", fontSize: 16 },
  greyed: { opacity: 1 },
  plain: { paddingVertical: 10, minHeight: 44 },
  leading: { alignSelf: "flex-start", justifyContent: "flex-start" },
  plainLabel: { fontWeight: "400", fontSize: 14, lineHeight: 20 },
  actionLabel: { fontWeight: "600", fontSize: 16, lineHeight: 22 },
});
