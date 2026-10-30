"use client";

import { useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiRequest } from "@/lib/api-client";
import { collapseReleaseNotes, parseReleaseNotes } from "@/lib/release-notes";
import type { UpdateCheck, UpdateSettings } from "@/lib/types";
import { UPDATE_COPY as COPY, checkedLine, installCopy, installing, latestRelease, updateRunLine, versionLabel } from "@/lib/update-copy";
import { checkForUpdate, installUpdate } from "@/lib/update-writes";

import { ExternalLink } from "./ExternalLink";
import { PRESS_OPACITY, useUI } from "./UIContext";
import { useInstallProgress } from "./use-install-progress";

/**
 * What installing needs: the updater's state (`useUpdateSettings`), the transport, a reload after
 * asking, and what to do once the new release answers (`onChanged` when not given).
 */
export type UpdateInstall = { settings: UpdateSettings | null; request: ApiRequest; onChanged: () => void; onInstalled?: (version: string) => void };

/** Below this width the running and newest release stack instead of sitting side by side. */
const SIDE_BY_SIDE_MIN = 440;

/**
 * A release-note link: on the web an anchor (react-native-web renders Text with `href` as `<a>`), so
 * Enter, middle-click and copy-link work; on a phone a press hands the address to the system browser.
 */
function noteLinkProps(href: string) {
  return Platform.OS === "web" ? ({ href, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } as object) : { onPress: () => void Linking.openURL(href) };
}

/** The newer of the polled check and the one Check now answered, by when the server asked. */
function newerCheck(polled: UpdateCheck | null, asked: UpdateCheck | null): UpdateCheck | null {
  if (!asked) return polled;
  if (!polled?.checkedAt) return asked;
  return asked.checkedAt && asked.checkedAt > polled.checkedAt ? asked : polled;
}

/**
 * The Updates card on Settings' Maintenance tab: the release FamilyFi runs beside the newest one. Up to
 * date, the newest reads "Latest" with Check now beside it; with a newer release, its version and
 * Install, then its notes. Install asks the Watchtower updater; without `install`, or before the
 * updater is set up, it stays disabled and the card says how to update by hand. Check now needs
 * `install`'s transport. `children` closes the card: the web puts the automatic update schedule there.
 * While an install runs, the card is covered by a spinner counting down the usual two minutes until
 * FamilyFi reports the new release.
 */
export function UpdateContent({ update: polled, install, children }: { update: UpdateCheck | null; install?: UpdateInstall; children?: ReactNode }) {
  const ui = useUI();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [asked, setAsked] = useState<UpdateCheck | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const text = (size: number, lineHeight: number, token: string) => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });
  const hairline = { borderColor: ui.color("hairline") };
  const update = newerCheck(polled, asked);
  const latest = latestRelease(update);
  const lastRun = install?.settings?.lastRun;
  const runLine = updateRunLine(lastRun, update?.currentVersion);
  const progress = useInstallProgress(install?.settings ?? null, install?.request, (version) => (install?.onInstalled ? install.onInstalled(version) : install?.onChanged()));
  const configured = Boolean(install?.settings?.updater.configured);
  // Until the updater's state has loaded, the button does not claim it is missing.
  const copy = latest ? installCopy(latest, configured || (install !== undefined && install.settings === null)) : null;
  const canInstall = Boolean(install) && configured && !installing(install?.settings) && !busy;
  const canCheck = Boolean(install) && !checking && update?.status !== "pending";
  // An earlier install's success says nothing about the release on offer; one of that release still does.
  const shownRun = latest && lastRun?.status === "succeeded" && versionLabel(lastRun.targetVersion) !== latest ? null : runLine;
  const sideBySide = width === 0 || width >= SIDE_BY_SIDE_MIN;

  async function start() {
    if (!install || !canInstall || !copy) return;
    const go = await ui.confirm({ title: copy.title, message: COPY.installConfirm, confirmLabel: copy.button });
    if (!go) return;
    setBusy(true);
    setError("");
    try {
      await installUpdate(install.request);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : COPY.installFailed);
    } finally {
      setBusy(false);
      install.onChanged();
    }
  }

  async function checkNow() {
    if (!install || !canCheck) return;
    setChecking(true);
    setError("");
    try {
      setAsked(await checkForUpdate(install.request));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : COPY.checkFailed);
    } finally {
      setChecking(false);
    }
  }

  // While an install runs, the card is covered: a large spinner and the countdown, nothing to press.
  const overlay = progress ? (
    <View style={styles.overlay} testID="update-progress">
      <View style={[StyleSheet.absoluteFill, styles.scrim, { backgroundColor: ui.color("card") }]} />
      <ActivityIndicator size="large" color={ui.color("accent")} style={styles.spinner} />
      <Text role="heading" aria-level={2} style={[text(17, 24, "ink"), styles.bold, styles.center]}>
        {`Installing ${versionLabel(progress.target)}`}
      </Text>
      <Text role="timer" style={[text(22, 28, "ink"), styles.bold, styles.center, styles.tabular]}>
        {progress.countdown}
      </Text>
      <Text style={[text(14, 20, "muted"), styles.center]}>{COPY.installOverlay}</Text>
    </View>
  ) : null;

  const checkLabel = checking ? COPY.checkingNow : COPY.checkNow;
  const chip = latest ? (
    <Text style={[text(13, 18, "accent"), styles.bold, styles.chip, { backgroundColor: ui.color("accent-tint"), borderColor: ui.color("accent-line") }]} testID="update-chip">
      {COPY.available}
    </Text>
  ) : update?.status === "ok" ? (
    <Text
      style={[text(13, 18, "verdict-open-ink"), styles.bold, styles.chip, { backgroundColor: ui.color("verdict-open-fill"), borderColor: ui.color("verdict-open-line") }]}
      testID="update-chip"
    >
      {COPY.upToDate}
    </Text>
  ) : null;

  const newest = latest ? (
    <>
      <View style={styles.valueRow}>
        <Text style={[text(22, 28, "ink"), styles.version]} testID="update-latest">
          {latest}
        </Text>
        <View style={styles.grow} />
        <Pressable
          role="button"
          aria-label={copy!.button}
          aria-disabled={!canInstall}
          disabled={!canInstall}
          onPress={() => void start()}
          style={({ pressed }) => [styles.button, { backgroundColor: ui.color("accent"), borderColor: ui.color("accent") }, !canInstall && styles.off, pressed && canInstall && { opacity: PRESS_OPACITY }]}
          testID="update-install"
        >
          <Text style={[text(14, 21, "ink-on-fill"), styles.bold]}>{COPY.install}</Text>
        </Pressable>
      </View>
      <View style={styles.checkedRow}>
        <Text style={[text(14, 20, "muted"), styles.grow]} testID="update-checked">
          {checkedLine(update)}
        </Text>
        {install ? (
          <Text role="button" aria-disabled={!canCheck} onPress={() => void checkNow()} style={[text(14, 20, "accent"), styles.bold, !canCheck && styles.off]} testID="update-check">
            {checkLabel}
          </Text>
        ) : null}
      </View>
    </>
  ) : (
    <>
      <View style={styles.valueRow}>
        <Text style={[text(22, 28, update?.status === "ok" ? "ink" : "muted"), styles.version]} testID="update-latest">
          {update?.status === "ok" ? COPY.latest : update?.status === "error" ? COPY.unknown : COPY.checkingNow}
        </Text>
        <View style={styles.grow} />
        {install ? (
          <Pressable
            role="button"
            aria-disabled={!canCheck}
            disabled={!canCheck}
            onPress={() => void checkNow()}
            style={({ pressed }) => [styles.button, { borderColor: ui.color("control-line"), backgroundColor: ui.color("card") }, !canCheck && styles.off, pressed && canCheck && { opacity: PRESS_OPACITY }]}
            testID="update-check"
          >
            <Text style={[text(14, 21, "ink"), styles.bold]}>{checkLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[text(14, 20, update?.status === "error" ? "danger" : "muted"), styles.checkedRow]} testID="update-checked">
        {checkedLine(update)}
      </Text>
    </>
  );

  const allSections = parseReleaseNotes(update?.releaseNotes ?? null);
  const collapsed = collapseReleaseNotes(allSections);
  const sections = notesOpen ? allSections : collapsed.sections;
  const notes = latest ? (
    <View role="region" aria-label={COPY.releaseNotes} style={[styles.rule, hairline]}>
      {sections.length === 0 ? (
        <Text style={[text(14, 21, "muted"), styles.section]}>{COPY.noNotes}</Text>
      ) : (
        sections.map((section, index) => (
          <View key={section.title} style={[styles.section, index > 0 && [styles.rule, hairline]]}>
            <Text role="heading" aria-level={3} style={[text(14, 21, "muted"), styles.bold, styles.sectionTitle]}>
              {section.title}
            </Text>
            <View role="list" style={styles.items}>
              {section.items.map((parts, item) => (
                <View key={item} role="listitem" style={styles.item}>
                  <Text aria-hidden style={text(14, 20, "ink")}>
                    •
                  </Text>
                  <Text style={[text(14, 20, "ink"), styles.grow]}>
                    {parts.map((part, at) =>
                      part.href ? (
                        <Text key={at} role="link" {...noteLinkProps(part.href)} style={[styles.bold, { color: ui.color("accent") }]}>
                          {part.text}
                        </Text>
                      ) : (
                        part.text
                      ),
                    )}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ))
      )}
      {collapsed.hidden > 0 || update?.releaseUrl ? (
        <View style={[styles.notesFoot, styles.rule, hairline]}>
          {collapsed.hidden > 0 ? (
            <Text role="button" aria-expanded={notesOpen} onPress={() => setNotesOpen(!notesOpen)} style={[text(14, 21, "accent"), styles.bold]} testID="update-notes-toggle">
              {notesOpen ? COPY.showFewerChanges : COPY.showAllChanges}
            </Text>
          ) : null}
          <View style={styles.grow} />
          {update?.releaseUrl ? (
            <ExternalLink href={update.releaseUrl} style={[text(14, 21, "ink"), styles.bold]} color={ui.color("ink")} testID="update-release-link">
              {COPY.viewOnGitHub}
            </ExternalLink>
          ) : null}
        </View>
      ) : null}
    </View>
  ) : null;

  // How installing works, the last install and anything that failed: under the notes, or the versions.
  const installHow = latest ? (configured ? COPY.backupWhere : COPY.installNote) : null;
  const foot =
    installHow || shownRun || error ? (
      <View style={[styles.foot, styles.rule, { borderColor: ui.color("hairline-card") }]}>
        {installHow ? <Text style={text(14, 20, "muted")}>{installHow}</Text> : null}
        {shownRun ? (
          <Text style={text(14, 20, lastRun?.status === "failed" ? "danger" : "muted")} testID="update-run">
            {shownRun}
          </Text>
        ) : null}
        {error ? <Text style={text(14, 20, "danger")}>{error}</Text> : null}
      </View>
    ) : null;

  return (
    <View role="region" aria-labelledby="update-title" style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }, overlay && styles.busy]} testID="update-content">
      <View style={[styles.head, { borderBottomColor: ui.color("hairline-card") }]}>
        <Text role="heading" aria-level={2} id="update-title" style={[text(14, 21, "ink"), styles.bold, styles.grow]}>
          {COPY.title}
        </Text>
        {chip}
      </View>
      <View style={[styles.versions, !sideBySide && styles.stacked]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View style={[styles.cell, sideBySide ? [styles.cellSide, hairline] : null]}>
          <Text style={[text(13, 18, "muted"), styles.bold, styles.label]}>{COPY.running}</Text>
          <Text style={[text(22, 36, "ink"), styles.version, styles.value]} testID="update-running">
            {update ? versionLabel(update.currentVersion) : "…"}
          </Text>
        </View>
        <View style={[styles.cell, !sideBySide && [styles.rule, hairline], latest ? { backgroundColor: ui.color("accent-wash") } : null]} testID="update-newest">
          <Text style={[text(13, 18, latest ? "accent" : "muted"), styles.bold, styles.label]}>{COPY.newest}</Text>
          {newest}
        </View>
      </View>
      {notes}
      {foot}
      {children}
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth: 1 },
  bold: { fontWeight: "600" },
  grow: { flex: 1, minWidth: 0 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 2, overflow: "hidden" },
  versions: { flexDirection: "row" },
  stacked: { flexDirection: "column" },
  cell: { flex: 1, minWidth: 0, paddingHorizontal: 18, paddingVertical: 16 },
  cellSide: { borderRightWidth: 1 },
  label: { letterSpacing: 0.35, textTransform: "uppercase" },
  version: { fontWeight: "700", fontVariant: ["tabular-nums"] },
  value: { marginTop: 4 },
  valueRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 4, minHeight: 36 },
  checkedRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 8 },
  button: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 7 },
  off: { opacity: 0.4 },
  rule: { borderTopWidth: 1 },
  section: { paddingHorizontal: 18, paddingVertical: 14 },
  sectionTitle: { letterSpacing: 0.35, textTransform: "uppercase" },
  items: { marginTop: 8, gap: 6 },
  item: { flexDirection: "row", gap: 8, paddingLeft: 4 },
  notesFoot: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 11 },
  foot: { gap: 6, paddingHorizontal: 18, paddingVertical: 14 },
  busy: { minHeight: 220 },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  scrim: { opacity: 0.97 },
  spinner: { transform: [{ scale: 1.5 }], marginBottom: 8 },
  center: { textAlign: "center" },
  tabular: { fontVariant: ["tabular-nums"] },
});
