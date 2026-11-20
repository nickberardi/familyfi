"use client";

import Link from "next/link";
import { useState } from "react";
import { PairPhoneSheet } from "@/components/pair/PairPhoneSheet";
import { PRIMARY_BUTTON, SECONDARY_BUTTON, SheetFrame } from "@/components/pair/SheetFrame";
import { request } from "@/lib/api";
import { CHILD_PHONES_COPY, PAIR_COPY } from "@/lib/pair-device";
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
  const { loaded, published, load } = usePairDevice(request);
  if (!loaded) return null;
  if (!published) {
    return (
      <SheetFrame
        title={PAIR_COPY.pairMe}
        size="confirm"
        sub={CHILD_PHONES_COPY.remoteFirst}
        onClose={onClose}
        footer={
          <>
            <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
              {PAIR_COPY.cancel}
            </button>
            <Link href="/pair" className={PRIMARY_BUTTON} onClick={onClose}>
              {PAIR_COPY.title}
            </Link>
          </>
        }
      />
    );
  }
  return <PairPhoneSheet route={published} child={{}} onClose={onClose} onPaired={() => void load()} />;
}
