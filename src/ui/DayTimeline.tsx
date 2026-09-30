import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type DimensionValue } from "react-native";

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
  const picked = chosen !== null ? bands[chosen] : undefined;
  const order = bands.map((band, index) => ({ band, index })).sort((a, b) => timelineRank(a.band) - timelineRank(b.band));
  const items = legend ? timelineLegend(bands) : [];
  const text = { fontFamily: ui.font, fontSize: 14, color: ui.color("ink-2") };
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
      <View accessibilityRole="none" accessibilityLabel={label} style={[styles.bar, { backgroundColor: ui.color("well") }]}>
        {order.map(({ band, index }) => (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityLabel={`${band.label}, ${bandTimes(band)}. ${band.source}`}
            accessibilityState={{ selected: chosen === index }}
            onPress={() => setChosen(chosen === index ? null : index)}
            style={[
              styles.band,
              { left: timelinePercent(band.from), width: timelinePercent(Math.max(band.to - band.from, 4)) },
              fill(band.kind),
            ]}
          />
        ))}
        <View
          pointerEvents="none"
          style={[styles.now, { left: localNowPercent(timezone, now ?? new Date()) as DimensionValue, backgroundColor: ui.color("now") }]}
        />
      </View>
      <View style={styles.hours} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {TIMELINE_HOURS.map((hour, index) => (
          <Text key={index} style={[text, { color: ui.color("muted") }]}>
            {hour}
          </Text>
        ))}
      </View>
      {picked ? (
        <Text accessibilityLiveRegion="polite" style={text}>
          <Text style={{ fontWeight: "600", color: ui.color("ink") }}>{picked.label}</Text> · {bandTimes(picked)} · {picked.source}
        </Text>
      ) : null}
      {items.length ? (
        <View style={styles.legend}>
          {items.map((item) => (
            <View key={`${item.kind}:${item.label}:${item.source}`} style={styles.legendItem}>
              <View style={[styles.swatch, fill(item.kind)]} />
              <Text style={text}>
                {item.label} {item.times}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "relative", height: 22, borderRadius: 6, overflow: "hidden" },
  band: { position: "absolute", top: 0, bottom: 0 },
  now: { position: "absolute", top: 0, bottom: 0, width: 2 },
  hours: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 6, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
});
