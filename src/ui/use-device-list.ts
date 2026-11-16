"use client";

import { useMemo, useState } from "react";

import { privateAddressDevices } from "@/lib/checkup";
import { DEVICE_FILTERS, DEVICES_COPY, deviceRemoveCopy, filterDevices, type DeviceFilterId } from "@/lib/device-list";
import { deleteDevice, setQuarantineEnforced } from "@/lib/device-writes";
import { runRuleAction } from "@/lib/group-writes";
import type { HouseholdPublic } from "@/lib/household-state";
import type { HouseholdStore } from "@/lib/household-store";
import { ruleStateLine } from "@/lib/rule-actions";
import { QUARANTINE_RULE_ID, type Rule } from "@/lib/rules";
import type { Device, Group } from "@/lib/types";

import { useUI } from "./UIContext";

/** The Devices list as `DevicesHeader` draws it and each client's own rows list it. */
export type DeviceList = ReturnType<typeof useDeviceList>;

const isFilter = (value: string | null | undefined): value is DeviceFilterId => DEVICE_FILTERS.some((item) => item.id === value);

/**
 * The Devices list behind each client's own rows: which devices show (the filter, the search and
 * Checkup's private-address filter), the group a link asked devices for, quarantine's switch and
 * its paused line, and removing a device after asking. The page's parameters are the web's:
 * `?assign=<group>` shows the Unassigned devices for a group with none, `?private=1` those with a
 * private Wi-Fi address, and `?filter=` opens on one filter. They are read as the list first shows;
 * a client whose list stays open behind other screens applies a later link itself (`setFilter`,
 * `setPrivateOnly`).
 */
export function useDeviceList({
  devices,
  groups,
  rules,
  household,
  mutate,
  now,
  params,
}: {
  devices: Device[];
  groups: Group[];
  rules: readonly Rule[];
  household: Pick<HouseholdPublic, "timezone" | "quarantineEnforced"> | null;
  mutate: HouseholdStore["mutate"];
  now: Date;
  params: { assign?: string | null; private?: string | null; filter?: string | null };
}) {
  const ui = useUI();
  const assignGroup = groups.find((group) => group.id === params.assign) ?? null;
  const [filter, setFilter] = useState<DeviceFilterId>(isFilter(params.filter) ? params.filter : assignGroup ? "loose" : "all");
  const [privateOnly, setPrivateOnly] = useState(params.private === "1");
  const [query, setQuery] = useState("");

  const privates = useMemo(() => privateAddressDevices(devices), [devices]);
  const privateMacs = useMemo(() => new Set(privates.map((device) => device.mac)), [privates]);
  const rows = useMemo(() => {
    const listed = filterDevices(devices, groups, filter, query);
    // The filter needs the notice that clears it: with no private addresses it does nothing.
    return privateOnly && privates.length ? listed.filter((device) => privates.includes(device)) : listed;
  }, [devices, filter, groups, query, privateOnly, privates]);

  const enforced = household?.quarantineEnforced === true;
  // Quarantine is also the built-in rule on Rules: while it is paused, the card says until when.
  const quarantineRule = rules.find((rule) => rule.id === QUARANTINE_RULE_ID);
  const pausedLine = quarantineRule && enforced ? ruleStateLine(quarantineRule, household?.timezone ?? "UTC", now) : null;

  return {
    devices,
    assignGroup,
    filter,
    setFilter,
    query,
    setQuery,
    privates,
    privateMacs,
    privateOnly,
    setPrivateOnly,
    togglePrivateOnly: () => setPrivateOnly((showing) => !showing),
    rows,
    /** Why the list is empty: no devices at all, or none that match. */
    emptyText: devices.length === 0 ? DEVICES_COPY.noDevices : DEVICES_COPY.noMatch,
    /** Null until the household is known, so the switch never shows a state it has not read. */
    quarantine: household
      ? {
          enforced,
          pausedLine,
          toggle: () => void setQuarantineEnforced(mutate, !enforced),
          resume: quarantineRule ? () => void runRuleAction(mutate, quarantineRule, "resume") : undefined,
        }
      : null,
    /** Asks first, saying what removing it does while quarantine keeps unassigned devices offline. */
    remove: async (device: Device) => {
      const copy = deviceRemoveCopy(device, enforced && !pausedLine);
      if (await ui.confirm({ title: copy.title, message: copy.message, confirmLabel: copy.confirm, destructive: true })) void deleteDevice(mutate, device);
    },
  };
}
