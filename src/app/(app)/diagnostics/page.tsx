"use client";

import { request } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { DIAGNOSTICS_COPY } from "@/lib/diagnostics-copy";
import { SETTINGS_COPY } from "@/lib/settings-copy";
import { GatewayHealthCard } from "@/ui/SettingsCards";
import { useGatewayHealth } from "@/ui/use-gateway-health";

/** Gateway load. The page asks the console for it when it opens and on Check now, never on its own. */
export default function DiagnosticsPage() {
  const { unifi } = useAppData();
  const gateway = useGatewayHealth(request, unifi);
  return (
    <>
      <PageHeader title={DIAGNOSTICS_COPY.title} sub={DIAGNOSTICS_COPY.sub} />
      <div className="p-4 md:p-6">
        <div className="w-full max-w-[640px]">
          {gateway.target !== null ? (
            <GatewayHealthCard health={gateway.health} checking={gateway.checking} error={gateway.error} onCheck={() => void gateway.check()} />
          ) : (
            <p className="text-[14px] text-[var(--ff-muted)]">{SETTINGS_COPY.healthNoGateway}</p>
          )}
        </div>
      </div>
    </>
  );
}
