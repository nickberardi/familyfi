"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAppData } from "@/components/AppDataProvider";
import { deviceModalHistory } from "@/components/DeviceLink";
import { PRIMARY_BUTTON, SheetFrame } from "@/components/pair/SheetFrame";
import { privateAddressDevices } from "@/lib/checkup";
import { DEVICE_MODAL_PARAM, deviceDetail, deviceModalSearch } from "@/lib/device-detail";
import { DEVICES_COPY } from "@/lib/device-list";
import { DeviceDetailContent } from "@/ui/DeviceDetailContent";
import { PrivateAddressCard } from "@/ui/PrivateAddress";

/** The device modal a wide screen opens over any page with `?device=<mac>`; its page is `/devices/<mac>`. */
export function DeviceDetailModal() {
  const mac = useSearchParams().get(DEVICE_MODAL_PARAM);
  useEffect(() => {
    // Back, or any other way the param goes, closes the modal; the next one starts fresh.
    if (!mac) deviceModalHistory.pushed = false;
  }, [mac]);
  return mac ? <DeviceModal key={mac} mac={mac} /> : null;
}

function DeviceModal({ mac }: { mac: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { devices, groups, unifi, household, loading, error } = useAppData();
  const [now, setNow] = useState(() => new Date(0));
  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  function close() {
    if (deviceModalHistory.pushed) {
      deviceModalHistory.pushed = false;
      router.back();
    } else {
      router.replace(`${pathname}${deviceModalSearch(searchParams.toString(), null)}`, { scroll: false });
    }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const device = devices.find((item) => item.mac.toLowerCase() === mac.toLowerCase());
  const group = device?.groupId ? groups.find((item) => item.id === device.groupId) : null;
  const timezone = household?.timezone ?? "UTC";
  const networks = unifi?.networks ?? [];
  const title = device ? deviceDetail(device, group, networks, timezone, now).name : DEVICES_COPY.title;

  return (
    <SheetFrame
      title={title}
      size="form"
      onClose={close}
      footer={
        <button type="button" autoFocus onClick={close} className={PRIMARY_BUTTON}>
          {DEVICES_COPY.detailDone}
        </button>
      }
    >
      {!device ? (
        <p className="text-[14px]">{loading ? DEVICES_COPY.detailLoading : error ? DEVICES_COPY.detailUnavailable : DEVICES_COPY.detailNotFound}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {privateAddressDevices([device]).length ? <PrivateAddressCard compact /> : null}
          <DeviceDetailContent device={device} group={group} networks={networks} timezone={timezone} now={now} compact />
        </div>
      )}
    </SheetFrame>
  );
}
