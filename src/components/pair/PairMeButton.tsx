"use client";

import Link from "next/link";
import { useState } from "react";
import { PairPhoneSheet } from "@/components/pair/PairPhoneSheet";
import { CANCEL_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON, SheetFrame } from "@/components/pair/SheetFrame";
import { request } from "@/lib/api";
import { CHILD_PHONES_COPY, PAIR_COPY } from "@/lib/pair-device";
import { Alert } from "@/ui/Alert";
import { usePairDevice } from "@/ui/use-pair-device";

/**
 * Pair FamilyFi Me, as a lesser header action (the Family page's): it reads remote access only once
 * pressed, then opens the pairing sheet, which asks which person, or says remote access comes first.
 */
export function PairMeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={SECONDARY_BUTTON} onClick={() => setOpen(true)} data-testid="family-pair-me">
        {PAIR_COPY.pairMe}
      </button>
      {open ? <PairMeFlow onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PairMeFlow({ onClose }: { onClose: () => void }) {
  const { loaded, published, load, error, forbidden } = usePairDevice(request);
  if (loaded && published) return <PairPhoneSheet route={published} child={{}} onClose={onClose} onPaired={() => void load()} />;
  // Until remote access has loaded the sheet says so; a failed read is a danger Alert with Try again.
  const failed = !loaded && (forbidden || Boolean(error));
  const cancel = (
    <button type="button" className={CANCEL_BUTTON} onClick={onClose}>
      {PAIR_COPY.cancel}
    </button>
  );
  return (
    <SheetFrame
      title={PAIR_COPY.pairMe}
      size="confirm"
      sub={loaded ? CHILD_PHONES_COPY.remoteFirst : failed ? undefined : CHILD_PHONES_COPY.loading}
      onClose={onClose}
      footer={
        loaded ? (
          <>
            {cancel}
            <Link href="/pair" className={PRIMARY_BUTTON} onClick={onClose}>
              {PAIR_COPY.openPairDevice}
            </Link>
          </>
        ) : (
          cancel
        )
      }
    >
      {failed ? (
        <Alert tone="danger" role="alert" action={forbidden ? undefined : { label: CHILD_PHONES_COPY.tryAgain, onPress: () => void load() }}>
          {forbidden ? PAIR_COPY.adminOnly : error}
        </Alert>
      ) : null}
    </SheetFrame>
  );
}
