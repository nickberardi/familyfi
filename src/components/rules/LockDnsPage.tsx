"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fromLockDnsRule, LOCK_DNS_COPY as COPY, lockDnsDirty, saveLockDns, validateLockDnsDraft, type LockDnsDraft } from "@/lib/lock-dns";
import { managedNetworks } from "@/lib/rule-editor";
import type { Rule } from "@/lib/rules";
import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { LockDnsForm } from "@/ui/LockDnsForm";

/** The built-in Lock DNS rule's page on the web: the shared form under the page header and its Save. */
export function LockDnsPage({ rule }: { rule: Rule }) {
  const router = useRouter();
  const { groups, unifi, store, busy } = useAppData();
  const [draft, setDraft] = useState<LockDnsDraft>(() => fromLockDnsRule(rule));
  const [error, setError] = useState("");
  const dirty = lockDnsDirty(rule, draft);

  async function save() {
    if (busy) return;
    const problem = validateLockDnsDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const result = await saveLockDns(store.mutate, rule, draft);
    if (result?.rule) router.push("/rules");
  }

  return (
    <>
      <PageHeader title={COPY.title} sub={COPY.summary} onAction={() => void save()} actionLabel={COPY.save} />
      <form
        className="flex max-w-[760px] flex-col gap-4 p-4 md:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-3">
          <Link href="/rules" className="text-[14px] font-semibold text-[var(--ff-accent)]">
            ‹ {COPY.back}
          </Link>
          {dirty ? <span className="text-[14px] text-[var(--ff-paused)]">{COPY.unsaved}</span> : null}
        </div>
        <LockDnsForm
          rule={rule}
          groups={groups}
          networks={managedNetworks(unifi)}
          draft={draft}
          error={error}
          edit={(next) => {
            setError("");
            setDraft(next);
          }}
        />
      </form>
    </>
  );
}
