"use client";

import { Platform, StyleSheet, Text, View } from "react-native";

import { verdictStyle, type UpstreamCheckRow } from "@/lib/upstream";
import { CATEGORIES_COPY } from "@/lib/upstream-writes";

import { Disclosure } from "./Disclosure";
import { useUI } from "./UIContext";
import { VerdictChip } from "./VerdictChip";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

/** The measured DNS answer for each managed network and its assigned servers, behind "Results by network". */
export function NetworkCheckDetails({ check }: { check: UpstreamCheckRow | null }) {
  if (!check?.networks?.length) return null;
  return (
    <Disclosure title={CATEGORIES_COPY.detail.resultsByNetwork} testID="network-results">
      <NetworkCheckResults networks={check.networks} />
    </Disclosure>
  );
}

function NetworkCheckResults({ networks }: { networks: NonNullable<UpstreamCheckRow["networks"]> }) {
  const ui = useUI();
  const muted = { fontFamily: ui.font, fontSize: 12, lineHeight: 18, color: ui.color("ink-3") };
  return (
    <View style={styles.list}>
      {networks.map((network) => (
        <View key={network.id} style={[styles.network, { borderTopColor: ui.color("hairline") }]}>
          <View style={styles.line}>
            <Text style={{ fontFamily: ui.font, fontSize: 12.5, lineHeight: 18.75, fontWeight: "600", color: ui.color("ink") }}>{network.name}</Text>
            <VerdictChip style={verdictStyle({ verdict: network.verdict })} size="small" />
          </View>
          {network.error ? <Text style={muted}>{network.error}</Text> : null}
          {network.servers.map((server) => (
            <View key={server.address} style={[styles.line, styles.server]}>
              <Text style={[muted, { fontFamily: MONO }]}>{server.address}</Text>
              <VerdictChip style={verdictStyle({ verdict: server.verdict })} size="small" />
              {server.error ? <Text style={muted}>{server.error}</Text> : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  network: { borderTopWidth: 1, paddingTop: 8 },
  line: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  server: { marginTop: 4 },
});
