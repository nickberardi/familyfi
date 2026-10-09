"use client";

import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ApiRequest } from "@/lib/api-client";
import type { UpdateSettings } from "@/lib/types";
import { UPDATE_COPY as COPY, updateScheduleLine } from "@/lib/update-copy";
import { saveUpdateSchedule } from "@/lib/update-writes";
import { toggleProbeDay } from "@/lib/upstream";

import { useUI } from "./UIContext";

/**
 * When FamilyFi installs a newer release on its own: on or off, the days and the household-local
 * time. New households install on Sunday at midnight. Without the Watchtower updater it says so and
 * changes nothing.
 */
export function UpdateScheduleCard({
  settings,
  request,
  timezone,
  onChanged,
}: {
  settings: UpdateSettings | null;
  request: ApiRequest;
  timezone: string;
  onChanged: () => void;
}) {
  const ui = useUI();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const text = (size: number, lineHeight: number, token: string) => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });
  if (!settings) return null;
  const schedule = settings.schedule;
  const off = busy || !settings.updater.configured;

  async function save(next: UpdateSettings["schedule"]) {
    setBusy(true);
    setError("");
    try {
      await saveUpdateSchedule(request, next);
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : COPY.scheduleFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      role="region"
      aria-labelledby="update-schedule-title"
      style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]}
      testID="update-schedule"
    >
      <View style={[styles.head, { borderBottomColor: ui.color("hairline-card") }]}>
        <View style={styles.grow}>
          <Text role="heading" aria-level={2} id="update-schedule-title" style={[text(14, 21, "ink"), styles.bold]}>
            {COPY.schedule}
          </Text>
          <Text style={text(14, 20, "muted")}>{COPY.scheduleSub}</Text>
        </View>
        <ui.Toggle
          label={COPY.schedule}
          on={schedule.enabled}
          disabled={off || (!schedule.enabled && schedule.days.length === 0)}
          onToggle={() => void save({ ...schedule, enabled: !schedule.enabled })}
          testID="update-schedule-toggle"
        />
      </View>
      <View style={styles.body}>
        <Text style={text(14, 20, "muted")} testID="update-schedule-line">
          {updateScheduleLine(settings, timezone, new Date())}
        </Text>
        <View style={styles.row}>
          <ui.DayPicker
            days={schedule.days}
            disabled={off}
            onToggle={(day) => {
              const days = toggleProbeDay(schedule.days, day);
              // The last day off turns the schedule off rather than leaving it on with nothing to run.
              void save({ ...schedule, days, enabled: schedule.enabled && days.length > 0 });
            }}
            testID="update-schedule-day"
          />
          <ui.TimeField
            label={COPY.scheduleTime}
            value={schedule.time}
            disabled={off}
            onChange={(time) => void save({ ...schedule, time })}
            testID="update-schedule-time"
          />
        </View>
        {error ? <Text style={[text(14, 20, "danger"), styles.error]}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth: 1 },
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: "600" },
  body: { paddingHorizontal: 18, paddingVertical: 14, gap: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  error: { marginTop: 2 },
});
