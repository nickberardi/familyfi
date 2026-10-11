"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ConnectAgentSheet } from "@/components/agents/ConnectAgentSheet";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/pair/SheetFrame";
import { copyText } from "@/components/ui/copy-text";
import { Icon } from "@/components/ui/Icon";

const ApiReference = dynamic(() => import("@/components/ApiReference").then((mod) => mod.ApiReference), {
  ssr: false,
  loading: () => <p className="px-6 py-4 text-[14px] text-[var(--ff-muted)]">Loading API reference…</p>,
});

function specUrl(): string {
  return `${window.location.origin}/openapi`;
}

/**
 * System → API: the reference, a link to its specification to hand to a tool, and the same agent
 * prompt Pair Device makes. Swagger's own title block is hidden; the header says it once.
 */
export function ApiPage({ demo }: { demo: boolean }) {
  // Where nothing can copy (a home server over plain http), the address is shown to select instead.
  const [copy, setCopy] = useState<"idle" | "copied" | "shown">("idle");
  const [connecting, setConnecting] = useState(false);

  return (
    <>
      <PageHeader
        title="FamilyFi API"
        sub="The HTTP API behind the web app, the phone app and paired AI agents. Try it out uses your signed-in session."
        secondary={
          <div className="flex basis-full justify-end gap-2 md:basis-auto">
            <button type="button" className={SECONDARY_BUTTON} onClick={() => setConnecting(true)}>
              Agent instructions
            </button>
            <button
              type="button"
              className={`${PRIMARY_BUTTON} inline-flex items-center gap-1.5`}
              title="Copy the OpenAPI spec's address"
              onClick={() => {
                void copyText(specUrl()).then((done) => {
                  if (!done) {
                    setCopy("shown");
                    return;
                  }
                  setCopy("copied");
                  setTimeout(() => setCopy("idle"), 1500);
                });
              }}
            >
              <Icon name="copy" size={16} />
              {copy === "copied" ? "Copied" : "OpenAPI spec"}
            </button>
          </div>
        }
      />
      {copy === "shown" ? (
        <p data-testid="api-spec-address" className="mx-4 mt-4 text-[14px] md:mx-6">
          Copy isn&rsquo;t available here. The OpenAPI spec is at <span className="font-mono break-all select-all">{specUrl()}</span>
        </p>
      ) : null}
      {demo ? (
        <p data-testid="api-demo-note" className="mx-4 mt-4 rounded-[9px] bg-[var(--ff-note-fill)] px-3 py-2.5 text-[14px] md:mx-6">
          A server in demo mode (the hosted public demo, where every visitor shares one household) refuses configuration writes with 403{" "}
          <code className="font-mono">demo_locked</code>: household and UniFi settings, accounts and passwords, the household&rsquo;s and groups&rsquo;
          resolvers, connection routes and their certificate pins, and remote access. Groups, rules, pauses, devices and pairing work as usual.
        </p>
      ) : null}
      <div className="ff-swagger min-w-0 px-2 pb-8 md:px-4">
        <ApiReference />
      </div>
      {connecting ? <ConnectAgentSheet onClose={() => setConnecting(false)} onConnected={() => undefined} /> : null}
    </>
  );
}
