/**
 * The FamilyFi lockup for the native app, from the web's geometry (`@/lib/logo`); the web's own
 * `Logo.web.tsx` draws it through `next/image`. The shield and the check shield are the supplied
 * artwork, placed; only the wordmark is live text. The shield carries the product's name, so the
 * wordmark and tagline beside it are hidden from screen readers. The lockup is artwork, drawn at
 * its sizes whatever the system text size, as a native lockup is. Pick `onDeep` by the ground
 * it sits on, not by a theme.
 */
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";

import { CHECK_SHIELD, LOGO_SIZES, SHIELD_RATIO, TAGLINE, type LogoSize } from "@/lib/logo";

import { useUI } from "./UIContext";

export type { LogoSize };

import shieldCheckDeep from "../../public/brand/shield-check-deep.png";
import shieldCheckLight from "../../public/brand/shield-check-light.png";
import shieldFamily from "../../public/brand/shield-family.png";

// Metro resolves an image import to an asset reference; the types describe Next's import.
const SHIELD = shieldFamily as unknown as ImageSourcePropType;
const CHECK_DEEP = shieldCheckDeep as unknown as ImageSourcePropType;
const CHECK_LIGHT = shieldCheckLight as unknown as ImageSourcePropType;

/** The shield with the family inside: the mark itself, named "FamilyFi". */
export function Shield({ size = 28 }: { size?: number }) {
  return (
    <Image
      source={SHIELD}
      alt="FamilyFi"
      accessibilityRole="image"
      style={{ width: Math.round(size * SHIELD_RATIO), height: size }}
    />
  );
}

/** Family in ink, Fi in brand cyan, the check shield dotting the "ı". */
export function Wordmark({ size = 21, onDeep = false }: { size?: number; onDeep?: boolean }) {
  const ui = useUI();
  const text = { fontFamily: ui.font, fontSize: size, lineHeight: size * 1.1, fontWeight: "700" as const, letterSpacing: -0.01 * size };
  const cyan = ui.color("brand-cyan");
  return (
    <View aria-hidden style={styles.row}>
      <Text allowFontScaling={false} style={[text, { color: ui.color(onDeep ? "brand-on-deep" : "ink") }]}>Family</Text>
      <Text allowFontScaling={false} style={[text, { color: cyan }]}>F</Text>
      {/* Android clips a view's children unless told otherwise; the check shield stands above the "ı". */}
      <View style={styles.dot}>
        <Text allowFontScaling={false} style={[text, { color: cyan }]}>{"ı"}</Text>
        <Image
          source={onDeep ? CHECK_DEEP : CHECK_LIGHT}
          alt=""
          style={{
            position: "absolute",
            width: Math.round(size * CHECK_SHIELD.width),
            height: Math.round(size * CHECK_SHIELD.height),
            // Centred on the dotless i's stem, its foot above the x-height.
            left: "50%",
            marginLeft: -Math.round(size * CHECK_SHIELD.width) / 2,
            bottom: CHECK_SHIELD.foot * size + (size * 1.1 - size) / 2 + size * 0.2,
          }}
        />
      </View>
    </View>
  );
}

/** FAMILY INTERNET CONTROLS between two brand rules. */
export function Tagline({ size = 10, onDeep = false }: { size?: number; onDeep?: boolean }) {
  const ui = useUI();
  const rule = <View style={{ width: 2.8 * size, height: 0.12 * size, backgroundColor: ui.color("brand-cyan") }} />;
  return (
    <View aria-hidden style={[styles.row, { alignItems: "center", gap: 0.82 * size }]}>
      {rule}
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: ui.font,
          fontSize: size,
          lineHeight: size * 1.4,
          fontWeight: "600",
          letterSpacing: 0.18 * size,
          textTransform: "uppercase",
          color: ui.color(onDeep ? "brand-on-deep-2" : "muted"),
        }}
      >
        {TAGLINE}
      </Text>
      {rule}
    </View>
  );
}

/** The lockup: shield over wordmark over tagline (`stacked`), or shield beside them (`inline`). */
export function Logo({
  variant = "stacked",
  size = "md",
  tagline = true,
  onDeep = false,
}: {
  variant?: "stacked" | "inline";
  size?: LogoSize;
  tagline?: boolean;
  onDeep?: boolean;
}) {
  const s = LOGO_SIZES[size];
  const stacked = variant === "stacked";
  return (
    <View style={[{ gap: s.gap, alignItems: "center" }, !stacked && styles.row]}>
      <Shield size={s.shield} />
      <View style={{ gap: stacked ? 6 : 3, alignItems: stacked ? "center" : "flex-start" }}>
        <Wordmark size={s.word} onDeep={onDeep} />
        {tagline ? <Tagline size={s.tag} onDeep={onDeep} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline", overflow: "visible" },
  dot: { overflow: "visible" },
});
