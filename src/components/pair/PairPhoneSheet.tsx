"use client";

import { request } from "@/lib/api";
import type { ConnectionRoute, PairedPhone } from "@/lib/types";
import { PairingActions, PairingBody } from "@/ui/PairingSheet";
import { usePairing } from "@/ui/use-pairing";
import { useAppData } from "@/components/AppDataProvider";
import { SheetFrame } from "./SheetFrame";

/**
 * Pair a phone through the published route: name the phone and choose the administrator it signs in
 * as, then show the single-use pairing code,
 * as a QR and as text to copy. Both are the same string, the only one the app accepts. Closing the sheet or
 * regenerating cancels a code nobody claimed, so a QR left on screen dies with it.
 */
export function PairPhoneSheet({
  route,
  replacing,
  onClose,
  onPaired,
}: {
  /** The one route Remote access publishes: the address the phone pairs over. */
  route: ConnectionRoute;
  /** Re-pairing: the (usually revoked) phone this pairing replaces once it is claimed. */
  replacing?: PairedPhone | null;
  onClose: () => void;
  onPaired: () => void;
}) {
  const { session } = useAppData();
  const pairing = usePairing({ request, route, replacing, username: session?.username ?? null, onPaired });
  return (
    <SheetFrame title={pairing.heading.title} sub={pairing.heading.sub} onClose={onClose} footer={<PairingActions pairing={pairing} onClose={onClose} />}>
      <PairingBody pairing={pairing} />
    </SheetFrame>
  );
}
