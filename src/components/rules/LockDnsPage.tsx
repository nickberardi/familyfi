"use client";

import { BackLink, EDITOR_PAGE } from "@/components/ui/BackLink";
import { useRouter } from "next/navigation";
import {
  LOCK_DNS_COPY as COPY,
  lockDnsDirty,
  lockDnsSummary,
} from "@/lib/lock-dns";
import { managedNetworks, ruleEditorBack } from "@/lib/rule-editor";
import type { Rule } from "@/lib/rules";
import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { LockDnsForm } from "@/ui/LockDnsForm";
import { useLockDnsEditor } from "@/ui/use-rule-editor";

/** The built-in Lock DNS rule's page on the web: the shared form under the page header and its Save. */
export function LockDnsPage({ rule, returnGroup }: { rule: Rule; returnGroup: string | null }) {
  const router = useRouter();
  const { groups, unifi, store, busy } = useAppData();
  const { href: back, label: backLabel } = ruleEditorBack(returnGroup, groups);
  const editor = useLockDnsEditor({ rule, mutate: store.mutate, off: busy });
  const { draft } = editor;
  const dirty = lockDnsDirty(rule, draft);

  async function save() {
    if (await editor.save()) router.push(back);
  }

  return (
    <>
      <PageHeader title={COPY.title} sub={lockDnsSummary(draft)} onAction={() => void save()} actionLabel={COPY.save} />
      <form
        className={EDITOR_PAGE}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-3">
          <BackLink href={back} label={backLabel} />
          {dirty ? <span className="text-[14px] text-[var(--ff-paused)]">{COPY.unsaved}</span> : null}
        </div>
        <LockDnsForm
          rule={rule}
          groups={groups}
          networks={managedNetworks(unifi)}
          draft={draft}
          error={editor.error}
          edit={editor.edit}
        />
      </form>
    </>
  );
}
