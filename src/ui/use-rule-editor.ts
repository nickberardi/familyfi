"use client";

import { useEffect, useState } from "react";

import type { ApiRequest } from "@/lib/api-client";
import { loadCheckup, type CheckupState } from "@/lib/checkup";
import { fromCountriesRule, saveCountriesRule, validateCountriesDraft, type CountriesDraft } from "@/lib/countries-editor";
import type { HouseholdStore } from "@/lib/household-store";
import { fromLockDnsRule, saveLockDns, validateLockDnsDraft, type LockDnsDraft } from "@/lib/lock-dns";
import { deleteRule, saveRule, validateRuleDraft, type EditorDraft } from "@/lib/rule-editor";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

type Mutate = HouseholdStore["mutate"];

/**
 * A draft and the refusal that describes it: an edit clears the refusal, which no longer
 * describes what the form holds. `save` validates first, then writes, and resolves true once the
 * rule is saved; while `off` it does nothing.
 */
function useDraft<D>(initial: D | (() => D), off: boolean, validate: (draft: D) => string | null | undefined, write: (draft: D) => Promise<{ rule?: Rule } | undefined>) {
  const [draft, setDraft] = useState<D>(initial);
  const [error, setError] = useState("");
  async function save(): Promise<boolean> {
    if (off) return false;
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return false;
    }
    const result = await write(draft);
    return Boolean(result?.rule);
  }
  return {
    draft,
    error,
    setError,
    edit: (next: (current: D) => D) => {
      setError("");
      setDraft(next);
    },
    save,
  };
}

/**
 * A household rule's editor without its frame: the draft, its refusal, the save and the delete.
 * The client asks before calling `remove`, which resolves true once the rule is deleted.
 */
export function useRuleEditor({ saved, initial, mutate, off }: { saved: Rule | null; initial: EditorDraft; mutate: Mutate; off: boolean }) {
  const editor = useDraft<EditorDraft>(initial, off, validateRuleDraft, (draft) => saveRule(mutate, draft, saved) as Promise<{ rule?: Rule } | undefined>);
  async function remove(): Promise<boolean> {
    if (!saved) return false;
    return Boolean(await deleteRule(mutate, saved));
  }
  return { ...editor, remove };
}

/** The built-in Lock DNS rule's editor without its frame. */
export function useLockDnsEditor({ rule, mutate, off }: { rule: Rule; mutate: Mutate; off: boolean }) {
  return useDraft<LockDnsDraft>(() => fromLockDnsRule(rule), off, validateLockDnsDraft, (draft) => saveLockDns(mutate, rule, draft) as Promise<{ rule?: Rule } | undefined>);
}

/** The built-in Block countries rule's editor without its frame. */
export function useCountriesEditor({ rule, groups, mutate, off }: { rule: Rule; groups: Group[]; mutate: Mutate; off: boolean }) {
  return useDraft<CountriesDraft>(
    () => fromCountriesRule(rule, groups),
    off,
    validateCountriesDraft,
    (draft) => saveCountriesRule(mutate, draft, rule) as Promise<{ rule?: Rule } | undefined>,
  );
}

/** The last checkup, for the editor's note on networks that hand out their own DNS; null until it loads or when it cannot. `request` must keep its identity between renders. */
export function useCheckup(request: ApiRequest): CheckupState | null {
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
  }, [request]);
  return checkup;
}
