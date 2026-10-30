"use client";

import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { DIAGNOSTICS_COPY as COPY, checkedAgo, formatLoad, formatPercent, formatUptime, loadTone, requestFigures, requestWindow, splitDevices } from "@/lib/diagnostics-copy";
import type { GatewayDeviceHealth, GatewayHealth } from "@/lib/types";

import { PRESS_OPACITY, useUI } from "./UIContext";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

function useText() {
  const ui = useUI();
  return (size: number, lineHeight: number, token: string) => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });
}

function Card({ title, sub, aside, children, testID }: { title: ReactNode; sub?: string; aside?: ReactNode; children: ReactNode; testID?: string }) {
  const ui = useUI();
  const text = useText();
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID={testID}>
      <View style={[styles.cardHead, { borderBottomColor: ui.color("hairline-card") }]}>
        <View style={styles.grow}>
          <Text style={[text(15, 21, "ink"), styles.bold]}>{title}</Text>
          {sub ? <Text style={[text(14, 20, "muted"), styles.sub]}>{sub}</Text> : null}
        </View>
        {aside}
      </View>
      {children}
    </View>
  );
}

/** A reading's share of full, as a bar coloured by how busy it is. */
function Meter({ percent }: { percent: number | null }) {
  const ui = useUI();
  const width = `${Math.min(100, Math.max(0, percent ?? 0))}%` as const;
  return (
    <View style={[styles.meter, { backgroundColor: ui.color("field") }]}>
      <View style={[styles.meterFill, { width, backgroundColor: ui.color(loadTone(percent)) }]} />
    </View>
  );
}

/**
 * The gateway's own panel: its CPU and memory large, its load and uptime, when it was checked, and
 * Check now. It also says why nothing could be read, and when the console named no gateway.
 */
export function GatewayLoadCard({
  health,
  checking,
  error,
  onCheck,
  now,
}: {
  health: GatewayHealth | null;
  checking: boolean;
  /** Why the last check failed; the last result, if any, stays shown under it. */
  error?: string;
  onCheck: () => void;
  now?: Date;
}) {
  const ui = useUI();
  const text = useText();
  const gateway = health?.devices ? splitDevices(health.devices).gateway : null;
  const problem = error || health?.devicesError;
  const title = gateway ? (
    <>
      {gateway.name}
      {gateway.model ? <Text style={[text(15, 21, "muted"), styles.regular]}>{` ${gateway.model}`}</Text> : null}
    </>
  ) : (
    COPY.gateway
  );
  const sub = health ? `${COPY.yourGateway} · ${checkedAgo(health.checkedAt, now)}` : checking ? COPY.checking : undefined;
  return (
    <Card
      title={title}
      sub={sub}
      testID="diagnostics-gateway"
      aside={
        <Pressable
          role="button"
          aria-disabled={checking}
          disabled={checking}
          onPress={onCheck}
          testID="diagnostics-check"
          style={({ pressed }) => [styles.button, { backgroundColor: ui.color("accent") }, checking && { opacity: 0.4 }, pressed && !checking && { opacity: PRESS_OPACITY }]}
        >
          <Text style={[text(14, 21, "ink-on-fill"), styles.bold]}>{checking ? COPY.checking : COPY.check}</Text>
        </Pressable>
      }
    >
      {problem ? <Text style={[text(14, 20, "muted"), styles.line]}>{problem}</Text> : null}
      {health?.devices?.length === 0 ? <Text style={[text(14, 20, "muted"), styles.line]}>{COPY.noDevices}</Text> : null}
      {health?.devices?.length && !gateway ? <Text style={[text(14, 20, "muted"), styles.line]}>{COPY.noGatewayDevice}</Text> : null}
      {gateway && !gateway.reported ? <Text style={[text(14, 20, "muted"), styles.line]}>{COPY.notReported}</Text> : null}
      {gateway?.reported ? (
        <View testID="diagnostics-device">
          <View style={styles.figures}>
            {[
              { label: COPY.cpu, value: gateway.cpuUtilizationPct },
              { label: COPY.memory, value: gateway.memoryUtilizationPct },
            ].map((figure) => (
              <View key={figure.label} style={styles.figure}>
                <Text style={text(14, 20, "muted")}>{figure.label}</Text>
                <Text style={[text(34, 42, "ink"), styles.big]}>{formatPercent(figure.value)}</Text>
                <Meter percent={figure.value} />
              </View>
            ))}
          </View>
          <View style={styles.facts}>
            <Text style={text(14, 20, "muted")}>
              {COPY.load} <Text style={[text(14, 20, "ink"), { fontFamily: MONO }]}>{formatLoad(gateway)}</Text>
            </Text>
            <Text style={text(14, 20, "muted")}>
              {COPY.up} <Text style={text(14, 20, "ink")}>{formatUptime(gateway.uptimeSec)}</Text>
            </Text>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/** Every UniFi device but the gateway, one row each with its CPU and memory. Nothing when there are none. */
export function OtherDevicesCard({ devices }: { devices: GatewayDeviceHealth[] | null | undefined }) {
  const ui = useUI();
  const text = useText();
  const others = devices ? splitDevices(devices).others : [];
  if (others.length === 0) return null;
  return (
    <Card title={COPY.others} testID="diagnostics-others">
      {others.map((device, index) => (
        <View key={device.id} style={[styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: ui.color("hairline") }]} testID="diagnostics-device">
          <View style={styles.name}>
            <Text style={[text(14, 20, "ink"), styles.bold]}>{device.name}</Text>
            <Text style={text(14, 20, "muted")}>{[device.model, device.reported ? `${COPY.up.toLowerCase()} ${formatUptime(device.uptimeSec)}` : null].filter(Boolean).join(" · ")}</Text>
          </View>
          {device.reported ? (
            <View style={styles.minis}>
              {[
                { label: COPY.cpu, value: device.cpuUtilizationPct },
                { label: COPY.memory, value: device.memoryUtilizationPct },
              ].map((figure) => (
                <View key={figure.label} style={styles.mini}>
                  <View style={styles.miniHead}>
                    <Text style={[text(14, 20, "muted"), styles.grow]}>{figure.label}</Text>
                    <Text style={text(14, 20, "ink")}>{formatPercent(figure.value)}</Text>
                  </View>
                  <Meter percent={figure.value} />
                </View>
              ))}
            </View>
          ) : (
            <Text style={[text(14, 20, "muted"), styles.name]}>{COPY.notReported}</Text>
          )}
        </View>
      ))}
    </Card>
  );
}

/** How hard FamilyFi itself has been working the console lately, and its busiest endpoints. */
export function ConsoleRequestsCard({ requests }: { requests: GatewayHealth["requests"] }) {
  const ui = useUI();
  const text = useText();
  return (
    <Card title={COPY.requests} sub={requestWindow(requests)} testID="diagnostics-requests">
      <View style={styles.counts}>
        {requestFigures(requests).map((figure) => (
          <View key={figure.label}>
            <Text style={[text(24, 30, figure.label === "failed" && requests.errors > 0 ? "danger" : "ink"), styles.big]}>{figure.value}</Text>
            <Text style={text(14, 20, "muted")}>{figure.label}</Text>
          </View>
        ))}
      </View>
      {requests.endpoints.slice(0, 5).map((entry) => (
        <View key={entry.endpoint} style={[styles.endpoint, { borderTopColor: ui.color("hairline") }]}>
          <Text style={[text(13, 19, "muted"), styles.grow, { fontFamily: MONO }]}>{entry.endpoint}</Text>
          <Text style={[text(13, 19, "ink"), styles.count, { fontFamily: MONO }]}>×{entry.count}</Text>
          <Text style={[text(13, 19, "muted"), styles.ms, { fontFamily: MONO }]}>{Math.round(entry.averageMs)} ms</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1 },
  bold: { fontWeight: "600" },
  regular: { fontWeight: "400" },
  big: { fontWeight: "700", letterSpacing: -0.5 },
  grow: { flex: 1, minWidth: 0 },
  sub: { marginTop: 2 },
  button: { flexShrink: 0, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  line: { paddingHorizontal: 18, paddingVertical: 12 },
  meter: { height: 6, borderRadius: 3, overflow: "hidden" },
  meterFill: { height: 6, borderRadius: 3 },
  figures: { flexDirection: "row", gap: 28, paddingHorizontal: 18, paddingTop: 18 },
  figure: { flex: 1, minWidth: 0, gap: 4 },
  facts: { flexDirection: "row", flexWrap: "wrap", columnGap: 28, rowGap: 4, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 16, rowGap: 8, paddingHorizontal: 18, paddingVertical: 12 },
  name: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
  minis: { flexDirection: "row", gap: 16, flexGrow: 1, flexBasis: 280 },
  mini: { flex: 1, minWidth: 0, gap: 4 },
  miniHead: { flexDirection: "row", gap: 8 },
  counts: { flexDirection: "row", gap: 28, paddingHorizontal: 18, paddingVertical: 14 },
  endpoint: { flexDirection: "row", alignItems: "baseline", gap: 12, paddingHorizontal: 18, paddingVertical: 8, borderTopWidth: 1 },
  count: { width: 44, textAlign: "right" },
  ms: { width: 64, textAlign: "right" },
});
