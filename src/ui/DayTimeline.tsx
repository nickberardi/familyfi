"use client";

import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type DimensionValue, type NativeSyntheticEvent } from "react-native";

import { localNowPercent } from "@/lib/display";
import {
  TIMELINE_BAND_LOOK,
  TIMELINE_HOURS,
  bandTimes,
  timelineLegend,
  timelinePercent,
  timelineRank,
  type TimelineBand,
} from "@/lib/day-timeline";

import { useUI } from "./UIContext";

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
  const picked = chosen !== null ? bands[chosen] : undefined;
  const order = bands.map((band, index) => ({ band, index })).sort((a, b) => timelineRank(a.band) - timelineRank(b.band));
  const items = legend ? timelineLegend(bands) : [];
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21, color: ui.color("ink-2") };
  const fill = (kind: TimelineBand["kind"]) => {
    const look = TIMELINE_BAND_LOOK[kind];
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
            onFocus={(event) => setRing(focusVisible(event) ? index : null)}
            onBlur={() => setRing(null)}
            // No press dimming: a band keeps its own opacity (a faded window is 0.22), as on the web.
            style={[
              styles.band,
              { left: timelinePercent(band.from), width: timelinePercent(Math.max(band.to - band.from, 4)) },
              fill(band.kind),
              // The bar clips anything outside a band, so its focus ring is drawn inside.
              ring === index && { outlineWidth: 2, outlineStyle: "solid", outlineOffset: -2, outlineColor: ui.color("ink") },
            ]}
          />
        ))}
        <View
          style={[styles.now, { pointerEvents: "none" }, { left: localNowPercent(timezone, now ?? new Date()) as DimensionValue, backgroundColor: ui.color("now") }]}
        />
      </View>
      <View style={styles.hours} aria-hidden>
        {TIMELINE_HOURS.map((hour, index) => (
          <Text key={index} style={[text, { color: ui.color("muted") }]}>
            {hour}
          </Text>
        ))}
      </View>
      {/* Always present, so a screen reader announces each choice as it fills. */}
      <Text aria-live="polite" style={text}>
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
              <View aria-hidden style={[styles.swatch, fill(item.kind)]} />
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
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 6, marginTop: 4 },
  // react-native-web keeps a View at full width (flexShrink 0); a long window name wraps instead.
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
});
