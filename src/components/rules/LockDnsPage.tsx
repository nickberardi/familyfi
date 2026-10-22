"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LOCK_DNS_COPY as COPY, lockDnsDirty, saveLockDnsGroups } from "@/lib/lock-dns";
import type { Rule } from "@/lib/rules";
import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { LockDnsForm } from "@/ui/LockDnsForm";

/** The built-in Lock DNS rule's page on the web: the shared form under the page header and its Save. */
export function LockDnsPage({ rule }: { rule: Rule }) {
  const router = useRouter();
  const { groups, store, busy } = useAppData();
  const [groupIds, setGroupIds] = useState<string[]>(rule.groupIds);
  const dirty = lockDnsDirty(rule, groupIds);

  async function save() {
    if (busy) return;
    const result = await saveLockDnsGroups(store.mutate, rule, groupIds);
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
        <LockDnsForm rule={rule} groups={groups} groupIds={groupIds} onChange={setGroupIds} />
      </form>
    </>
  );
}
