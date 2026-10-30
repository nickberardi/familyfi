"use client";

import { request } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { DIAGNOSTICS_COPY } from "@/lib/diagnostics-copy";
import { ConsoleRequestsCard, GatewayLoadCard, OtherDevicesCard } from "@/ui/DiagnosticsCards";
import { useGatewayHealth } from "@/ui/use-gateway-health";

/**
 * The gateway's panel and the other UniFi devices beside FamilyFi's own requests to the console.
 * The page asks the console when it opens and on Check now, never on its own.
 */
export default function DiagnosticsPage() {
  const { unifi } = useAppData();
  const gateway = useGatewayHealth(request, unifi);
  return (
    <>
      <PageHeader title={DIAGNOSTICS_COPY.title} sub={DIAGNOSTICS_COPY.sub} />
      <div className="p-4 md:p-6">
        {gateway.target === null ? (
          <p className="text-[14px] text-[var(--ff-muted)]">{DIAGNOSTICS_COPY.noGateway}</p>
        ) : (
          <div className="grid max-w-[1180px] grid-cols-1 items-start gap-[18px] xl:grid-cols-[3fr_2fr]">
            <div className="flex min-w-0 flex-col gap-[18px]">
              <GatewayLoadCard health={gateway.health} checking={gateway.checking} error={gateway.error} onCheck={() => void gateway.check()} />
              <OtherDevicesCard devices={gateway.health?.devices} />
            </div>
            {gateway.health ? (
              <div className="min-w-0">
                <ConsoleRequestsCard requests={gateway.health.requests} />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
