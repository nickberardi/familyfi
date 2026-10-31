"use client";

import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/api";
import { useAppData } from "@/components/AppDataProvider";
import { FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON, SheetFrame } from "@/components/pair/SheetFrame";
import { Segmented } from "@/components/ui/Segmented";
import {
  FAMILY_ROLES,
  GROUP_DETAIL_COPY,
  GROUP_EDIT_COPY,
  MONOGRAM_MAX,
  deleteGroupConfirm,
  groupEditBody,
  groupEditError,
  groupEditSheetDraft,
  groupResolverEdit,
  roleLocked,
  type FamilyRole,
  type GroupDohMode,
  type GroupEditSheetDraft,
} from "@/lib/group-form";
import { GROUP_RESOLVER_COPY, groupResolverNetworkLine, groupResolverSummary, loadGroupResolver, type GroupResolver } from "@/lib/group-resolver";
import { deleteGroup, updateGroup } from "@/lib/group-writes";
import type { Group } from "@/lib/types";

const LABEL = "flex flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)]";

/**
 * The group detail's Edit sheet, as the design's "Edit <name>" modal has it: name, then role for a
 * person or monogram for a Things group, then where its category checks reach DNS. Deleting the
 * group starts here too and asks first. Saving sends the group's fields, then its resolver, so a
 * resolver that fails leaves the name saved and the sheet open to try that part again.
 */
export function GroupEditSheet({
  group,
  demo,
  opener,
  onClose,
  onDeleted,
}: {
  group: Group;
  demo: boolean;
  /** Where focus goes back to when the sheet closes. */
  opener: HTMLElement | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { store, busy, accounts } = useAppData();
  const lockedRole = roleLocked(group, accounts);
  const [initial] = useState(() => groupEditSheetDraft(group));
  const [draft, setDraft] = useState<GroupEditSheetDraft>(initial);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  // Undefined while it loads, so the sheet never says "unavailable" before it has asked.
  const [resolver, setResolver] = useState<GroupResolver | null | undefined>(undefined);
  // An edit clears the last refusal, which no longer describes what the sheet holds.
  const set = (patch: Partial<GroupEditSheetDraft>) => {
    setError("");
    setDraft((current) => ({ ...current, ...patch }));
  };

  useEffect(() => {
    let live = true;
    void loadGroupResolver(request, group.id).then((next) => live && setResolver(next));
    return () => {
      live = false;
    };
  }, [group.id]);

  // Escape closes, and focus goes back to the Edit button that opened the sheet.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Strict Mode remounts the sheet at once: only a sheet that is really gone hands focus back.
      window.setTimeout(() => {
        if (opener?.isConnected && !document.querySelector('[role="dialog"]')) opener.focus();
      }, 0);
    };
  }, [opener]);

  const dirty = (Object.keys(initial) as (keyof GroupEditSheetDraft)[]).some((key) => draft[key] !== initial[key]);
  const failure = () => store.getState().error || GROUP_RESOLVER_COPY.saveFailed;

  async function save() {
    const problem = groupEditError(draft);
    if (problem) return setError(problem);
    setError("");
    const name = draft.name.trim();
    if (groupEditBody(group, draft)) {
      const saved = await updateGroup(store.mutate, group, draft, { notice: GROUP_EDIT_COPY.saved(name) });
      if (!saved) return setError(failure());
    }
    const resolverEdit = demo ? ({ kind: "none" } as const) : groupResolverEdit(group.dohOverrideUrl, draft);
    if (resolverEdit.kind !== "none") {
      const path = `/api/v1/groups/${group.id}/resolver`;
      const saved = await store.mutate(
        (send) => (resolverEdit.kind === "set" ? send(path, { method: "PUT", body: { url: resolverEdit.url } }) : send(path, { method: "DELETE" })),
        { groupId: group.id, feedback: { notice: GROUP_EDIT_COPY.saved(name) } },
      );
      if (!saved) return setError(failure());
    }
    onClose();
  }

  if (confirming) {
    const copy = deleteGroupConfirm(group);
    return (
      <SheetFrame
        title={copy.title}
        size="form"
        onClose={onClose}
        footer={
          <>
            <button type="button" autoFocus onClick={() => setConfirming(false)} className={SECONDARY_BUTTON}>
              {copy.cancel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void deleteGroup(store.mutate, group, onDeleted)}
              className="rounded-lg bg-[var(--ff-danger)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)] disabled:opacity-40"
            >
              {copy.confirm}
            </button>
          </>
        }
      >
        <p className="text-[14px] leading-5">{copy.body}</p>
      </SheetFrame>
    );
  }

  const custom = draft.doh === "custom";
  return (
    <SheetFrame
      title={GROUP_EDIT_COPY.title(group.name)}
      size="form"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className="mr-auto py-2 text-[14px] font-semibold text-[var(--ff-danger)] disabled:opacity-40"
          >
            {GROUP_EDIT_COPY.delete}
          </button>
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
            {GROUP_EDIT_COPY.cancel}
          </button>
          <button type="submit" form="group-edit-form" disabled={busy || !dirty} className={PRIMARY_BUTTON}>
            {busy ? GROUP_EDIT_COPY.saving : GROUP_EDIT_COPY.save}
          </button>
        </>
      }
    >
      <form
        id="group-edit-form"
        className="flex flex-col gap-3.5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className={LABEL}>
          {GROUP_DETAIL_COPY.name}
          <input autoFocus className={FIELD} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        {group.kind === "family" ? (
          <div className={LABEL}>
            <span id="group-edit-role">{GROUP_DETAIL_COPY.role}</span>
            <Segmented<FamilyRole>
              name={GROUP_DETAIL_COPY.role}
              value={draft.familyRole}
              segments={FAMILY_ROLES.map((role) => ({ ...role, disabled: lockedRole && role.value !== "adult" }))}
              onChange={(familyRole) => set({ familyRole })}
              size="lg"
              grow
            />
            {lockedRole ? <span className="font-normal">{GROUP_DETAIL_COPY.roleLocked}</span> : null}
          </div>
        ) : (
          <label className={LABEL}>
            {GROUP_DETAIL_COPY.monogram}
            <input maxLength={MONOGRAM_MAX} className={FIELD} value={draft.monogram} onChange={(e) => set({ monogram: e.target.value })} />
          </label>
        )}
        <div className={LABEL}>
          <span>{GROUP_EDIT_COPY.doh}</span>
          <Segmented<GroupDohMode>
            name={GROUP_EDIT_COPY.doh}
            value={draft.doh}
            segments={GROUP_EDIT_COPY.dohModes.map((mode) => ({ ...mode, disabled: demo }))}
            onChange={(doh) => set({ doh })}
            size="lg"
            grow
          />
        </div>
        {custom ? (
          <label className={LABEL}>
            {GROUP_EDIT_COPY.url}
            <input
              type="url"
              inputMode="url"
              spellCheck={false}
              disabled={demo}
              className={`${FIELD} font-mono break-all`}
              placeholder={GROUP_EDIT_COPY.urlPlaceholder}
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              data-testid="group-edit-url"
            />
          </label>
        ) : null}
        <div className="flex flex-col gap-1 text-[14px] leading-5 text-[var(--ff-ink-2)]" data-testid="group-edit-dns-help">
          {demo ? (
            <p>{GROUP_EDIT_COPY.demoLocked}</p>
          ) : custom ? (
            <p>{GROUP_RESOLVER_COPY.overrideNote(draft.name.trim() || group.name)}</p>
          ) : (
            <>
              {resolver !== undefined ? <p>{groupResolverSummary(resolver)}</p> : null}
              {resolver?.networks.map((network) => <p key={network.id}>{groupResolverNetworkLine(network)}</p>)}
            </>
          )}
          <p>{GROUP_RESOLVER_COPY.hostNote}</p>
        </div>
        {error ? (
          <p role="alert" className="rounded-[9px] border border-[var(--ff-paused-line)] bg-[var(--ff-paused-fill)] px-3 py-2 text-[14px] leading-5 font-semibold text-[var(--ff-paused)]">
            {error}
          </p>
        ) : null}
      </form>
    </SheetFrame>
  );
}
