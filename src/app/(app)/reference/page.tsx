"use client";

import dynamic from "next/dynamic";
import { PageHeader } from "@/components/PageHeader";

const ApiReference = dynamic(() => import("@/components/ApiReference").then((mod) => mod.ApiReference), {
  ssr: false,
  loading: () => <p className="px-6 py-4 text-[14px] text-[var(--ff-muted)]">Loading API reference…</p>,
});

export default function ApiPage() {
  return (
    <>
      <PageHeader
        title="API"
        sub="OpenAPI 3.1 reference for the web app and a future native client. Try it out uses your signed-in session."
      />
      <div className="ff-swagger min-w-0 px-2 pb-8 md:px-4">
        <ApiReference />
      </div>
    </>
  );
}
