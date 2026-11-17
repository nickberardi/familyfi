"use client";

import { useState } from "react";

import { PairPhoneSheet } from "@/components/pair/PairPhoneSheet";
import { askConfirm } from "@/components/ui/ConfirmHost";
import { request } from "@/lib/api";
import { childPhonesOf, revokeConfirm, revokePhone } from "@/lib/pair-device";
import type { Group } from "@/lib/types";
import { Alert } from "@/ui/Alert";
import { ChildPhonesCard } from "@/ui/ChildPhonesCard";
import { usePairDevice } from "@/ui/use-pair-device";

/** A family member's FamilyFi Me phones on their page, with Pair FamilyFi Me for them and Revoke. */
export function GroupChildPhones({ group }: { group: Group }) {
  const { phones, error, load, run, published, canPair } = usePairDevice(request);
  const [pairing, setPairing] = useState(false);
  return (
    <>
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      <ChildPhonesCard
        group={group}
        phones={childPhonesOf(phones, group.id)}
        canPair={canPair}
        onPair={() => setPairing(true)}
        onRevoke={async (phone) => {
          if (!(await askConfirm({ ...revokeConfirm(phone), destructive: true }))) return;
          void run(() => revokePhone(request, phone));
        }}
      />
      {pairing && published ? (
        <PairPhoneSheet
          route={published}
          child={{ groupId: group.id }}
          onClose={() => {
            setPairing(false);
            void load();
          }}
          onPaired={() => void load()}
        />
      ) : null}
    </>
  );
}
