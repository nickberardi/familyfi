"use client";

import { PageHeader } from "@/components/PageHeader";
import { request } from "@/lib/api";
import { UPDATE_COPY } from "@/lib/update-copy";
import { UpdateContent } from "@/ui/UpdateContent";
import { useUpdateCheck } from "@/ui/use-update-check";

export default function UpdatePage() {
  const update = useUpdateCheck(request);
  return (
    <>
      <PageHeader title={UPDATE_COPY.title} sub={UPDATE_COPY.sub} />
      <div className="p-4 md:p-6">
        <UpdateContent update={update} />
      </div>
    </>
  );
}
