"use client";

import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { parseReleaseNotes } from "@/lib/release-notes";
import type { UpdateCheck } from "@/lib/types";
import { INSTALL_STEPS, UPDATE_COPY as COPY, installCopy, latestRelease, upToDateLine } from "@/lib/update-copy";

import { ExternalLink } from "./ExternalLink";
import { useUI } from "./UIContext";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

/**
 * The Update page below its header: whether FamilyFi is up to date, or a newer release's notes and
 * what installing it will do. Install itself is not built yet, so its button stays disabled.
 */
export function UpdateContent({ update, onNotNow }: { update: UpdateCheck | null; onNotNow?: () => void }) {
  const ui = useUI();
  const text = (size: number, lineHeight: number, token: string) => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });
  const card = { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") };
  const latest = latestRelease(update);

  if (!latest) {
    return (
      <Text style={[text(14, 21, "muted"), styles.card, styles.status, card]} testID="update-status">
        {upToDateLine(update)}
      </Text>
    );
  }

  const sections = parseReleaseNotes(update?.releaseNotes ?? null);
  const install = installCopy(latest);
  return (
    <View style={styles.columns} testID="update-content">
      <View role="region" aria-label={COPY.releaseNotes} style={[styles.card, styles.column, card]}>
        <View style={[styles.head, styles.headRow, { borderBottomColor: ui.color("hairline-card") }]}>
          <Text role="heading" aria-level={2} style={[text(14, 21, "ink"), styles.bold]}>
            {COPY.releaseNotes}
          </Text>
          <Text style={[text(14, 21, "muted"), { fontFamily: MONO }]}>{latest}</Text>
          <View style={styles.grow} />
          {update?.releaseUrl ? (
            <ExternalLink href={update.releaseUrl} style={[text(14, 21, "ink"), styles.bold]} color={ui.color("ink")} testID="update-release-link">
              {COPY.viewOnGitHub}
            </ExternalLink>
          ) : null}
        </View>
        {sections.length === 0 ? (
          <Text style={[text(14, 21, "muted"), styles.section]}>{COPY.noNotes}</Text>
        ) : (
          sections.map((section, index) => (
            <View key={section.title} style={[styles.section, index > 0 && { borderTopWidth: 1, borderTopColor: ui.color("hairline") }]}>
              <Text role="heading" aria-level={3} style={[text(14, 21, "muted"), styles.bold, styles.sectionTitle]}>
                {section.title}
              </Text>
              <View role="list" style={styles.items}>
                {section.items.map((item) => (
                  <View key={item} role="listitem" style={styles.item}>
                    <Text aria-hidden style={text(14, 20, "ink")}>
                      •
                    </Text>
                    <Text style={[text(14, 20, "ink"), styles.grow]}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
      </View>

      <View role="region" aria-label={install.title} style={[styles.card, styles.column, card]}>
        <View style={[styles.head, { borderBottomColor: ui.color("hairline-card") }]}>
          <Text role="heading" aria-level={2} style={[text(14, 21, "ink"), styles.bold]}>
            {install.title}
          </Text>
          <Text style={[text(14, 20, "muted"), styles.installNote]}>{COPY.installNote}</Text>
        </View>
        {INSTALL_STEPS.map((step, index) => (
          <View key={step} style={[styles.step, index > 0 && { borderTopWidth: 1, borderTopColor: ui.color("hairline") }]}>
            <View aria-hidden style={[styles.stepDot, { backgroundColor: ui.color("field") }]} />
            <Text style={[text(14, 21, "muted"), styles.grow]}>{step}</Text>
          </View>
        ))}
        <View style={styles.actions}>
          {onNotNow ? (
            <Text role="button" onPress={onNotNow} style={[text(14, 21, "muted"), styles.bold, styles.outline, { borderColor: ui.color("control-line") }]} testID="update-not-now">
              {COPY.notNow}
            </Text>
          ) : (
            <ui.Link href="/family" testID="update-not-now">
              <Text style={[text(14, 21, "muted"), styles.bold, styles.outline, { borderColor: ui.color("control-line") }]}>{COPY.notNow}</Text>
            </ui.Link>
          )}
          <Pressable role="button" aria-disabled disabled style={[styles.install, { backgroundColor: ui.color("accent") }]} testID="update-install">
            <Text style={[text(14, 21, "ink-on-fill"), styles.bold]}>{install.button}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  status: { padding: 18 },
  columns: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 16 },
  column: { flexGrow: 1, flexBasis: 320, minWidth: 0 },
  head: { paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth: 1 },
  headRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 10 },
  bold: { fontWeight: "600" },
  grow: { flex: 1, minWidth: 0 },
  section: { paddingHorizontal: 18, paddingVertical: 14 },
  sectionTitle: { letterSpacing: 0.35, textTransform: "uppercase" },
  items: { marginTop: 8, gap: 6 },
  item: { flexDirection: "row", gap: 8, paddingLeft: 4 },
  installNote: { marginTop: 2 },
  step: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 11 },
  stepDot: { width: 22, height: 22, borderRadius: 11, flexShrink: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, paddingHorizontal: 18, paddingVertical: 14 },
  outline: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, overflow: "hidden" },
  install: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, opacity: 0.4 },
});
