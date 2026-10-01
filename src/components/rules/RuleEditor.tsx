"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { request } from "@/lib/api";
import {
  RULE_EDITOR_COPY as COPY,
  blankDraft,
  deleteRule,
  deleteRuleCopy,
  fromRule,
  managedNetworks as managedNetworksOf,
  ruleEditorBack,
  ruleEditorParams,
  ruleEditorState,
  saveRule,
  validateRuleDraft,
  type EditorDraft as Draft,
} from "@/lib/rule-editor";
import type { Rule } from "@/lib/rules";
import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { RuleEditorForm } from "@/ui/RuleEditorForm";

type Params = Promise<{ id: string }>;
type Search = Promise<{
  group?: string | string[];
  kind?: string | string[];
  target?: string | string[];
  /** A starting name, e.g. "AI for Sam" from a category's sheet. */
  name?: string | string[];
  /** Comma-separated websites for a Websites rule, e.g. a category's domains. */
  domains?: string | string[];
}>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function RuleEditorPage({ params, searchParams }: { params?: Params; searchParams: Search }) {
  const id = params ? use(params).id : null;
  const search = use(searchParams);
  const { rules, loading } = useAppData();
  const rule = id ? rules.find((item) => item.id === id) : undefined;
  if (id && !rule) {
    if (loading) return null;
    return <p className="p-6 text-[14px] text-[var(--ff-muted)]">{COPY.notFound}</p>;
  }
  return (
    <RuleEditor
      key={rule?.id ?? "new"}
      saved={rule ?? null}
      initial={rule ? fromRule(rule) : blankDraft(ruleEditorParams(search))}
      returnGroup={one(search.group) ?? null}
    />
  );
}

function RuleEditor({ saved, initial, returnGroup }: { saved: Rule | null; initial: Draft; returnGroup: string | null }) {
  const router = useRouter();
  const { groups, unifi, store, busy } = useAppData();
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const edit = (next: (current: Draft) => Draft) => {
    setError("");
    setDraft(next);
  };

  const { href: back, label: backLabel } = ruleEditorBack(returnGroup, groups);
  const { title, summary, dirty } = ruleEditorState(draft, saved);
  const managedNetworks = managedNetworksOf(unifi);

  async function save() {
    if (busy) return;
    const problem = validateRuleDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const result = await saveRule(store.mutate, draft, saved);
    if (result?.rule) router.push(back);
  }

  async function remove() {
    if (!saved) return;
    const result = await deleteRule(store.mutate, saved);
    if (result) router.push(back);
  }

  return (
    <>
      <PageHeader
        title={title}
        sub={summary}
        onAction={() => void save()}
        actionLabel={saved ? COPY.save : COPY.create}
        secondary={
          saved ? (
            <button
              type="button"
              className="rounded-lg px-3.5 py-2 text-[14px] font-semibold"
              style={{ background: "var(--ff-danger-fill)", color: "var(--ff-danger)" }}
              onClick={() => setConfirmDelete(true)}
            >
              {COPY.deleteRule}
            </button>
          ) : null
        }
      />
      <form
        className="flex max-w-[760px] flex-col gap-4 p-4 md:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-3">
          <Link href={back} className="text-[14px] font-semibold text-[var(--ff-accent)]">
            ‹ {backLabel}
          </Link>
          {saved && dirty ? <span className="text-[14px] text-[var(--ff-paused)]">{COPY.unsaved}</span> : null}
        </div>
        <RuleEditorForm
          draft={draft}
          saved={saved}
          groups={groups}
          networks={managedNetworks}
          request={request}
          error={error}
          edit={edit}
          onError={setError}
        />
      </form>

      {confirmDelete && saved ? (
        <div className="fixed inset-0 z-[81] flex items-center justify-center bg-[var(--ff-scrim)] p-6" onClick={() => setConfirmDelete(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-rule-title"
            className="w-full max-w-[420px] overflow-hidden rounded-[14px] bg-[var(--ff-card)]"
            style={{ boxShadow: "var(--ff-shadow-sheet)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-2 p-5">
              <h2 id="delete-rule-title" className="text-[17px] font-bold tracking-tight">
                {deleteRuleCopy(saved).title}
              </h2>
              <p className="text-[14px] leading-5 text-[var(--ff-ink-2)]">{deleteRuleCopy(saved).message}</p>
              <ul className="font-mono text-[14px] text-[var(--ff-ink-2)]">
                {saved.policyNames.map((name) => (
                  <li key={name} className="line-through">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex border-t border-[var(--ff-hairline-card)]">
              <button type="button" className="flex-1 py-3 text-[14px] text-[var(--ff-ink-3)]" onClick={() => setConfirmDelete(false)}>
                {deleteRuleCopy(saved).cancel}
              </button>
              <button
                type="button"
                className="flex-1 border-l border-[var(--ff-hairline-card)] py-3 text-[14px] font-semibold text-[var(--ff-danger)]"
                onClick={() => void remove()}
              >
                {deleteRuleCopy(saved).confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
