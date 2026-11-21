"use client";

import { useState } from "react";
import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { AppStoresCard } from "@/components/pair/AppStoresCard";
import { PairPhoneSheet } from "@/components/pair/PairPhoneSheet";
import { PRIMARY_BUTTON } from "@/components/pair/SheetFrame";
import { askConfirm } from "@/components/ui/ConfirmHost";
import { request } from "@/lib/api";
import { CHILD_PHONES_COPY, ME_APP_STORES, ME_PAGE_COPY as COPY, PAIR_COPY, revokeConfirm, revokePhone } from "@/lib/pair-device";
import { Alert } from "@/ui/Alert";
import { MePhonesCard, SharedThingsCard } from "@/ui/PairMeCards";
import { AsksCard } from "@/ui/SettingsCards";
import { usePairDevice } from "@/ui/use-pair-device";

const CARD = "overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]";

/**
 * System › Pair FamilyFi Me: where to get FamilyFi Me, the FamilyFi Me phones paired, how long an ask
 * waits, and the Things FamilyFi Me shows. The header's Pair FamilyFi Me asks which person in the sheet.
 */
export function PairMePage() {
  const { groups, household, store } = useAppData();
  const { phones, error, loaded, forbidden, load, run, published, canPair } = usePairDevice(request);
  const [pairing, setPairing] = useState(false);

  if (forbidden) {
    return (
      <>
        <PageHeader title={COPY.title} sub={COPY.sub} />
        <div className="p-4 md:p-6">
          <div className={`${CARD} px-[18px] py-4 text-[14px]`}>{PAIR_COPY.adminOnly}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={COPY.title}
        sub={COPY.sub}
        // The page's one action, in the secondary slot because it is disabled, with why, while remote access is off.
        secondary={
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={!canPair}
            title={canPair || !loaded ? undefined : CHILD_PHONES_COPY.remoteFirst}
            onClick={() => setPairing(true)}
            data-testid="pair-me-header"
          >
            {PAIR_COPY.pairMe}
          </button>
        }
      />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {/* A change that failed; a failed load is the paired devices card's own. */}
        {error && loaded ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}

        <AppStoresCard stores={ME_APP_STORES} title={COPY.getApp} sub={COPY.getAppSub} testId="me-app-stores" />

        <MePhonesCard
          phones={phones}
          canPair={canPair}
          status={loaded ? "ready" : error ? "failed" : "loading"}
          onRetry={() => void load()}
          onRevoke={async (phone) => {
            if (!(await askConfirm({ ...revokeConfirm(phone), destructive: true }))) return;
            void run(() => revokePhone(request, phone));
          }}
        />

        {household?.askTimeoutMinutes !== undefined && household.askWaitMinutes !== undefined ? (
          <AsksCard timeout={household.askTimeoutMinutes} wait={household.askWaitMinutes} ahead={household.askAheadMinutes} mutate={store.mutate} />
        ) : null}

        <SharedThingsCard groups={groups} mutate={store.mutate} />
      </div>

      {pairing && published ? (
        <PairPhoneSheet
          route={published}
          child={{}}
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
