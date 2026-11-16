"use client";

import { useEffect, useState } from "react";

import type { ApiRequest, ErrorNotice } from "@/lib/api-client";
import {
  GROUP_EDIT_COPY,
  blockButtonChoices,
  groupEditBody,
  groupEditError,
  groupEditSheetDraft,
  groupResolverEdit,
  roleLocked,
  type GroupEditSheetDraft,
} from "@/lib/group-form";
import { GROUP_RESOLVER_COPY, loadGroupResolver, type GroupResolver } from "@/lib/group-resolver";
import { updateGroup } from "@/lib/group-writes";
import type { HouseholdStore } from "@/lib/household-store";
import type { Rule } from "@/lib/rules";
import type { Account, Group } from "@/lib/types";

/** A group's edit as `GroupEditForm` draws it and each client's own Save button sends it. */
export type GroupEdit = ReturnType<typeof useGroupEdit>;

/**
 * A group's Edit sheet, without its frame: the draft of its name, role or monogram, Block button
 * default and DNS-over-HTTPS choice, the resolver its note describes, and the save. Saving sends
 * the group's fields, then its resolver, so a resolver that fails leaves the name saved and the
 * sheet open to try that part again.
 */
export function useGroupEdit({
  group,
  store,
  request,
  accounts,
  rules,
  timezone,
  demo = false,
}: {
  group: Group;
  store: Pick<HouseholdStore, "mutate" | "getState">;
  request: ApiRequest;
  accounts: readonly Pick<Account, "recovery" | "groupId">[];
  rules: Rule[];
  /** The household's time zone, which names the Block button's choices; null until it is known. */
  timezone: string | null;
  /** The demo's one household keeps its DNS settings, so the resolver is never sent. */
  demo?: boolean;
}) {
  const [draft, setDraft] = useState<GroupEditSheetDraft>(() => groupEditSheetDraft(group));
  const [error, setError] = useState<ErrorNotice | null>(null);
  // Undefined while it loads, so the sheet never says "unavailable" before it has asked.
  const [resolver, setResolver] = useState<GroupResolver | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void loadGroupResolver(request, group.id).then((next) => live && setResolver(next));
    return () => {
      live = false;
    };
  }, [request, group.id]);

  // Measured against the group as saved now, not as the sheet opened: after a save that only partly
  // landed, putting a field back to how it was is still a change to send.
  const saved = groupEditSheetDraft(group);
  const dirty = (Object.keys(saved) as (keyof GroupEditSheetDraft)[]).some((key) => draft[key] !== saved[key]);
  const failure = (): ErrorNotice => {
    const { error: text, errorLink } = store.getState();
    return { text: text || GROUP_RESOLVER_COPY.saveFailed, ...(errorLink ? { link: errorLink } : {}) };
  };

  /** Resolves true once everything changed is saved; false leaves the reason in `error`. */
  async function save(): Promise<boolean> {
    const problem = groupEditError(draft);
    if (problem) {
      setError({ text: problem });
      return false;
    }
    setError(null);
    const feedback = { notice: GROUP_EDIT_COPY.saved(draft.name.trim()) };
    if (groupEditBody(group, draft) && !(await updateGroup(store.mutate, group, draft, feedback))) {
      setError(failure());
      return false;
    }
    const edit = demo ? ({ kind: "none" } as const) : groupResolverEdit(group.dohOverrideUrl, draft);
    if (edit.kind !== "none") {
      const path = `/api/v1/groups/${group.id}/resolver`;
      const result = await store.mutate(
        (send) => (edit.kind === "set" ? send(path, { method: "PUT", body: { url: edit.url } }) : send(path, { method: "DELETE" })),
        { groupId: group.id, feedback },
      );
      if (!result) {
        setError(failure());
        return false;
      }
    }
    return true;
  }

  return {
    group,
    draft,
    /** An edit clears the last refusal, which no longer describes what the sheet holds. */
    set: (patch: Partial<GroupEditSheetDraft>) => {
      setError(null);
      setDraft((current) => ({ ...current, ...patch }));
    },
    error,
    resolver,
    dirty,
    /** A family member with their own login stays an adult. */
    roleLocked: group.kind === "family" && roleLocked(group, accounts),
    /** The Block button default's choices; the setting shows only when there is more than one. */
    blockButtonChoices: timezone ? blockButtonChoices(group, rules, timezone, new Date()) : [],
    demo,
    save,
  };
}
