"use client";

import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { DEVICE_FILTERS, deviceFilterLabel, type DeviceFilterId } from "@/lib/device-list";

import { AssignNeededBanner } from "./AssignNeededBanner";
import { PrivateAddressNotice } from "./PrivateAddress";
import { QuarantineCard } from "./QuarantineCard";
import { useUI } from "./UIContext";
import type { DeviceList } from "./use-device-list";

/**
 * What sits above the Devices list on every client: the group a link asked devices for, quarantine's
 * switch, the private-address notice, and the filter. The filter is the platform's segmented control
 * unless the client passes its own row, as the web does to keep its search beside it.
 */
export function DevicesHeader({
  list,
  disabled,
  filter,
}: {
  list: DeviceList;
  /** While a write is under way or the household is stale. */
  disabled?: boolean;
  filter?: ReactNode;
}) {
  const ui = useUI();
  const { quarantine } = list;
  return (
    <View style={styles.header}>
      {list.needsDevices ? <AssignNeededBanner group={list.needsDevices} /> : null}
      {quarantine ? <QuarantineCard enforced={quarantine.enforced} disabled={disabled} onToggle={quarantine.toggle} pausedLine={quarantine.pausedLine} onResume={quarantine.resume} /> : null}
      {list.privates.length ? <PrivateAddressNotice count={list.privates.length} showing={list.privateOnly} onShow={list.togglePrivateOnly} /> : null}
      {filter ?? (
        <ui.Segmented
          name="Show"
          value={list.filter}
          segments={DEVICE_FILTERS.map((item) => ({ value: item.id, label: deviceFilterLabel(item, list.devices) }))}
          onChange={(next) => list.setFilter(next as DeviceFilterId)}
          testID="device-filter"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 16 },
});
