"use client";

import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { SYNC_COPY } from "@/lib/sync-copy";
import { SyncContent } from "@/ui/SyncContent";

export default function SyncPage() {
  const { sync, household } = useAppData();
  return (
    <>
      <PageHeader title={SYNC_COPY.title} sub={SYNC_COPY.sub} />
      <div className="p-4 md:p-6">
        <SyncContent sync={sync} timezone={household?.timezone ?? "America/New_York"} />
      </div>
    </>
  );
}
