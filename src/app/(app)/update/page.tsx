"use client";

import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { request } from "@/lib/api";
import { UPDATE_COPY, installedVersion } from "@/lib/update-copy";
import { APP_VERSION } from "@/lib/version";
import { UpdateContent } from "@/ui/UpdateContent";
import { UpdateScheduleCard } from "@/ui/UpdateScheduleCard";
import { useUpdateCheck } from "@/ui/use-update-check";
import { useUpdateSettings } from "@/ui/use-update-settings";

export default function UpdatePage() {
  const update = useUpdateCheck(request);
  const { settings, reload } = useUpdateSettings(request);
  const { household } = useAppData();
  // The new release serves new pages, so the browser reloads onto it; a page it already served only rereads.
  const onInstalled = (version: string) => (installedVersion(APP_VERSION, version) ? reload() : window.location.reload());
  return (
    <>
      <PageHeader title={UPDATE_COPY.title} sub={UPDATE_COPY.sub} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <UpdateContent update={update} install={{ settings, request, onChanged: reload, onInstalled }} />
        <UpdateScheduleCard settings={settings} request={request} timezone={household?.timezone ?? "America/New_York"} onChanged={reload} />
      </div>
    </>
  );
}
