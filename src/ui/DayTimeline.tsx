"use client";

import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type DimensionValue, type NativeSyntheticEvent } from "react-native";

import { localNowPercent } from "@/lib/display";
import {
  TIMELINE_HOURS,
  bandTimes,
  timelineHours,
  timelineLegend,
  timelinePercent,
  timelineBandLook,
  timelineRank,
  type TimelineBand,
} from "@/lib/day-timeline";

import { useUI } from "./UIContext";
import { useLargeText } from "./use-large-text";

/**
 * Today on a 24-hour bar, shared by every client: the time a group has no internet, and why.
 * Every band is a button: choosing one names its source (the rule and window, or who paused).
 */
export function DayTimeline({
  bands,
  timezone,
  now,
  label,
  legend = true,
}: {
  bands: TimelineBand[];
  timezone: string;
  /** The household's current time, for the now line; defaults to the wall clock. */
  now?: Date;
  /** What the bar shows, for its accessible name: "Emma's internet today". */
  label: string;
  legend?: boolean;
}) {
  const ui = useUI();
  const [chosen, setChosen] = useState<number | null>(null);
  const [ring, setRing] = useState<number | null>(null);
  // The hour row's width and each label's own width, so only the labels that fit are shown.
  const [hoursWidth, setHoursWidth] = useState(0);
  const [hourWidths, setHourWidths] = useState<number[]>(() => TIMELINE_HOURS.map(() => 0));
  const largeText = useLargeText();
  const measured = hoursWidth > 0 && hourWidths.every((width) => width > 0);
  // Until the labels are measured, large text starts from the ends and noon, so all five never overlap.
  const hours = !measured && largeText ? [TIMELINE_HOURS[0], TIMELINE_HOURS[2], TIMELINE_HOURS[4]] : timelineHours(hoursWidth, hourWidths);
  const picked = chosen !== null ? bands[chosen] : undefined;
  const order = bands.map((band, index) => ({ band, index })).sort((a, b) => timelineRank(a.band) - timelineRank(b.band));
  const items = legend ? timelineLegend(bands) : [];
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21, color: ui.color("ink-2") };
  const fill = (band: Pick<TimelineBand, "kind" | "tone" | "dim">) => {
    const look = timelineBandLook(band);
    return {
      backgroundColor: ui.color(look.fill),
      opacity: look.opacity,
      ...(look.line ? { borderWidth: 1, borderColor: ui.color(look.line) } : null),
    };
  };

  return (
    <View>
      <View role="group" aria-label={label} style={[styles.bar, { backgroundColor: ui.color("well") }]}>
        {order.map(({ band, index }) => (
          <Pressable
            key={index}
            role="button"
            aria-label={`${band.label}, ${bandTimes(band)}. ${band.source}`}
            aria-pressed={chosen === index}
            // React Native has no aria-pressed; this carries the same state to VoiceOver and TalkBack.
            accessibilityState={{ selected: chosen === index }}
            onPress={() => setChosen(chosen === index ? null : index)}
            // The bar is 22 pt: 44 to touch on a phone. react-native-web ignores it.
            hitSlop={{ top: 11, bottom: 11 }}
            onFocus={(event) => setRing(focusVisible(event) ? index : null)}
            onBlur={() => setRing(null)}
            // No press dimming: a band keeps its own opacity (a faded window is 0.22), as on the web.
            style={[
              styles.band,
              { left: timelinePercent(band.from), width: timelinePercent(Math.max(band.to - band.from, 4)) },
              fill(band),
              // The bar clips anything outside a band, so its focus ring is drawn inside.
              ring === index && { outlineWidth: 2, outlineStyle: "solid", outlineOffset: -2, outlineColor: ui.color("ink") },
            ]}
          />
        ))}
        <View
          style={[styles.now, { pointerEvents: "none" }, { left: localNowPercent(timezone, now ?? new Date()) as DimensionValue, backgroundColor: ui.color("now") }]}
        />
      </View>
      <View style={styles.hours} aria-hidden onLayout={(event) => setHoursWidth(event.nativeEvent.layout.width)}>
        {hours.map((hour, index) => (
          <Text key={index} style={[text, { color: ui.color("muted") }]}>
            {hour}
          </Text>
        ))}
        {/* Every label at its own width, unseen, to tell which fit at the current text size. */}
        <View style={[styles.measure, { pointerEvents: "none" }]}>
          {TIMELINE_HOURS.map((hour, index) => (
            <Text
              key={index}
              numberOfLines={1}
              style={[text, styles.measured]}
              onLayout={(event) => {
                const width = event.nativeEvent.layout.width;
                setHourWidths((widths) => (widths[index] === width ? widths : widths.map((known, at) => (at === index ? width : known))));
              }}
            >
              {hour}
            </Text>
          ))}
        </View>
      </View>
      {/* Always present, so a screen reader announces each choice as it fills; no height while empty. */}
      <Text aria-live="polite" style={[text, !picked && styles.empty]}>
        {picked ? (
          <>
            <Text style={{ fontWeight: "600", color: ui.color("ink") }}>{picked.label}</Text> · {bandTimes(picked)} · {picked.source}
          </>
        ) : null}
      </Text>
      {items.length ? (
        <View role="list" style={styles.legend}>
          {items.map((item) => (
            <View role="listitem" key={`${item.kind}:${item.label}:${item.source}`} style={styles.legendItem}>
              <View aria-hidden style={[styles.swatch, fill(item)]} />
              <Text style={[text, { flexShrink: 1 }]}>
                {item.label} {item.times}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Whether focus should show a ring: on the web only for keyboard focus (`:focus-visible`), as a button's. */
function focusVisible(event: NativeSyntheticEvent<unknown>): boolean {
  const { target } = (event.nativeEvent ?? {}) as { target?: { matches?: (selector: string) => boolean } };
  return target?.matches ? target.matches(":focus-visible") : true;
}

const styles = StyleSheet.create({
  bar: { position: "relative", height: 22, borderRadius: 6, overflow: "hidden" },
  band: { position: "absolute", top: 0, bottom: 0 },
  now: { position: "absolute", top: 0, bottom: 0, width: 2 },
  hours: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  // Hidden, unselectable copies of every label, measured so the visible row shows only those that fit.
  measure: { position: "absolute", top: 0, left: 0, flexDirection: "row", opacity: 0, userSelect: "none" },
  measured: { flexShrink: 0 },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 6, marginTop: 4 },
  // react-native-web keeps a View at full width (flexShrink 0); a long window name wraps instead.
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  empty: { height: 0, overflow: "hidden" },
});
