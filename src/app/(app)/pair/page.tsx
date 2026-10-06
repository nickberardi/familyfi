"use client";

import { useState } from "react";
import { ConnectAgentSheet } from "@/components/agents/ConnectAgentSheet";
import { PageHeader } from "@/components/PageHeader";
import { HomeAccessCard } from "@/components/pair/HomeAccessCard";
import { PairPhoneSheet } from "@/components/pair/PairPhoneSheet";
import { RemoteAccessCard } from "@/components/pair/RemoteAccessCard";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/pair/SheetFrame";
import { request } from "@/lib/api";
import { PAIR_COPY, confirmLine, removeAllConfirm, removeConfirm, removePhone, removeRevokedPhones, revokeConfirm, revokePhone } from "@/lib/pair-device";
import type { PairedPhone } from "@/lib/types";
import { PairedDevicesCard } from "@/ui/PairedDevices";
import { usePairDevice } from "@/ui/use-pair-device";

const CARD = "overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]";
const TITLE = PAIR_COPY.title;
const SUB = PAIR_COPY.sub;

export default function PairDevicePage() {
  const { tunnel, setTunnel, routes, phones, remote, forbidden, error, load, run, published, canPair, pairedThrough } = usePairDevice(request);
  const [pairing, setPairing] = useState(false);
  const [replacing, setReplacing] = useState<PairedPhone | null>(null);
  const [connecting, setConnecting] = useState(false);

  if (forbidden) {
    return (
      <>
        <PageHeader title={TITLE} sub={SUB} />
        <div className="p-4 md:p-6">
          <div className={`${CARD} px-[18px] py-4 text-[14px]`}>{PAIR_COPY.adminOnly}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={TITLE}
        sub={SUB}
        secondary={
          <div className="flex basis-full justify-end gap-2 md:basis-auto">
            <button type="button" className={SECONDARY_BUTTON} onClick={() => setConnecting(true)}>
              {PAIR_COPY.connectAgent}
            </button>
            {/* Phones pair through the published route, so there is nothing to pair through while remote access is Off. */}
            <button type="button" className={PRIMARY_BUTTON} disabled={!canPair} title={canPair ? undefined : PAIR_COPY.remoteFirstPhones} onClick={() => setPairing(true)}>
              {PAIR_COPY.pairPhone}
            </button>
          </div>
        }
      />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {error ? (
          <p role="alert" className="rounded-[9px] bg-[var(--ff-danger-fill)] px-3 py-2.5 text-[14px] font-semibold text-[var(--ff-danger)]">
            {error}
          </p>
        ) : null}

        <HomeAccessCard
          agents={phones}
          onRevoke={(agent) => {
            if (!window.confirm(confirmLine(revokeConfirm(agent)))) return;
            void run(() => revokePhone(request, agent));
          }}
        />

        <RemoteAccessCard tunnel={tunnel} routes={routes} phones={remote} pairedThrough={pairedThrough} onTunnel={setTunnel} onChange={load} />

        <PairedDevicesCard
          phones={phones}
          phonesOnly
          canPair={canPair}
          onRevoke={(phone) => {
            if (!window.confirm(confirmLine(revokeConfirm(phone)))) return;
            void run(() => revokePhone(request, phone));
          }}
          onRepair={(phone) => {
            setReplacing(phone);
            setPairing(true);
          }}
          onRemove={(phone) => {
            if (!window.confirm(confirmLine(removeConfirm(phone)))) return;
            void run(() => removePhone(request, phone));
          }}
          onRemoveAllRevoked={(count) => {
            if (!window.confirm(confirmLine(removeAllConfirm(count)))) return;
            void run(() => removeRevokedPhones(request));
          }}
        />
      </div>

      {connecting ? <ConnectAgentSheet onClose={() => setConnecting(false)} onConnected={() => void load()} /> : null}

      {pairing && published ? (
        <PairPhoneSheet
          route={published}
          replacing={replacing}
          onClose={() => {
            setPairing(false);
            setReplacing(null);
            void load();
          }}
          onPaired={() => void load()}
        />
      ) : null}
    </>
  );
}
