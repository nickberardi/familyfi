"use client";

import { CANCEL_BUTTON, DESTRUCTIVE_BUTTON, SheetFrame } from "@/components/pair/SheetFrame";
import { use, useEffect, useState } from "react";
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
import {
  COUNTRIES_EDITOR_COPY,
  countriesEditorState,
  fromCountriesRule,
  saveCountriesRule,
  validateCountriesDraft,
  type CountriesDraft,
} from "@/lib/countries-editor";
import { loadCheckup, outsideDnsNote, type CheckupState } from "@/lib/checkup";
import type { Rule } from "@/lib/rules";
import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { CountriesRuleForm } from "@/ui/CountriesRuleForm";
import { RuleEditorForm } from "@/ui/RuleEditorForm";
import { LockDnsPage } from "./LockDnsPage";

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
  if (rule?.builtIn === "dns") return <LockDnsPage key={rule.id} rule={rule} />;
  if (rule?.builtIn === "countries") return <CountriesEditor key={rule.id} saved={rule} returnGroup={one(search.group) ?? null} />;
  if (rule?.builtIn) {
    return (
      <p className="p-6 text-[14px] text-[var(--ff-muted)]">
        {COPY.builtIn}{" "}
        <Link href={ruleEditorBack(null, []).href} className="text-[var(--ff-accent)]">
          {ruleEditorBack(null, []).label}
        </Link>
      </p>
    );
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
  const { groups, devices, unifi, store, busy } = useAppData();
  const checkup = useCheckup();
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
            <button type="button" className={DESTRUCTIVE_BUTTON} onClick={() => setConfirmDelete(true)}>
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
          outsideDns={outsideDnsNote(draft, devices, checkup)}
          edit={edit}
          onError={setError}
        />
      </form>

      {confirmDelete && saved ? (
        <SheetFrame
          title={deleteRuleCopy(saved).title}
          sub={deleteRuleCopy(saved).message}
          size="confirm"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button type="button" autoFocus className={CANCEL_BUTTON} onClick={() => setConfirmDelete(false)}>
                {deleteRuleCopy(saved).cancel}
              </button>
              <button type="button" className={DESTRUCTIVE_BUTTON} onClick={() => void remove()}>
                {deleteRuleCopy(saved).confirm}
              </button>
            </>
          }
        >
          <ul className="font-mono text-[14px] text-[var(--ff-ink-2)]">
            {saved.policyNames.map((name) => (
              <li key={name} className="line-through">
                {name}
              </li>
            ))}
          </ul>
        </SheetFrame>
      ) : null}
    </>
  );
}

/** Block countries: its switch, countries and groups. Its name, kind and schedule are FamilyFi's. */
function CountriesEditor({ saved, returnGroup }: { saved: Rule; returnGroup: string | null }) {
  const router = useRouter();
  const { groups, unifi, store, busy } = useAppData();
  const [draft, setDraft] = useState<CountriesDraft>(() => fromCountriesRule(saved, groups));
  const [error, setError] = useState("");
  const { href: back, label: backLabel } = ruleEditorBack(returnGroup, groups);
  const { summary, dirty } = countriesEditorState(draft, saved, groups);

  async function save() {
    if (busy) return;
    const problem = validateCountriesDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const result = await saveCountriesRule(store.mutate, draft, saved);
    if (result?.rule) router.push(back);
  }

  return (
    <>
      <PageHeader title={COUNTRIES_EDITOR_COPY.title} sub={summary} onAction={() => void save()} actionLabel={COUNTRIES_EDITOR_COPY.save} />
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
          {dirty ? <span className="text-[14px] text-[var(--ff-paused)]">{COUNTRIES_EDITOR_COPY.unsaved}</span> : null}
        </div>
        <CountriesRuleForm
          draft={draft}
          groups={groups}
          networks={managedNetworksOf(unifi)}
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

/** The last checkup, for the editor's note on networks that hand out their own DNS; null until it loads or when it cannot. */
function useCheckup(): CheckupState | null {
  const [checkup, setCheckup] = useState<CheckupState | null>(null);
  useEffect(() => {
    let live = true;
    loadCheckup(request).then(
      (next) => live && setCheckup(next),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return checkup;
}
