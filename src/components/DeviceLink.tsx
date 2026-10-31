"use client";

import type { ComponentProps, MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { deviceHref, deviceModalSearch } from "@/lib/device-detail";
import type { Device } from "@/lib/types";

/** The web's `md` breakpoint: from here up a device opens in a modal over the page it was picked on. */
const WIDE = "(min-width: 768px)";

/**
 * Whether the open device modal was pushed onto history by a click here, so closing it can step back
 * instead of leaving a second copy of the page behind. A modal reached by a link or a refresh was not,
 * and has no opener to return focus to.
 */
export const deviceModalHistory: { pushed: boolean; opener: HTMLElement | null } = { pushed: false, opener: null };

/**
 * A link to a device. Its address is the device's page, which a phone, a new tab and a refresh get.
 * A plain click on a wide screen opens the device's modal over the current page instead.
 */
export function DeviceLink({
  device,
  fromGroupId,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { device: Pick<Device, "mac">; fromGroupId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  function open(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!window.matchMedia(WIDE).matches) return;
    event.preventDefault();
    deviceModalHistory.pushed = true;
    // Closing the modal hands focus back to the row that opened it.
    deviceModalHistory.opener = event.currentTarget;
    router.push(`${pathname}${deviceModalSearch(window.location.search, device.mac)}`, { scroll: false });
  }
  return <Link {...props} href={deviceHref(device, fromGroupId)} onClick={open} />;
}
