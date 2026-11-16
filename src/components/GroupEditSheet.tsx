"use client";

import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/api";
import { useAppData } from "@/components/AppDataProvider";
import { CANCEL_BUTTON, DESTRUCTIVE_BUTTON, PRIMARY_BUTTON, SheetFrame } from "@/components/pair/SheetFrame";
import { GROUP_EDIT_COPY, deleteGroupConfirm, rulesOnlyFor } from "@/lib/group-form";
import { deleteGroup } from "@/lib/group-writes";
import type { Group } from "@/lib/types";
import { GroupEditForm } from "@/ui/GroupEditForm";
import { useGroupEdit } from "@/ui/use-group-edit";

/**
 * The group detail's Edit sheet: the shared `GroupEditForm` in the web's dialog frame, with Save,
 * Cancel and Delete in its footer. Deleting the group starts here too and asks first.
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
  const { store, busy, accounts, rules, household } = useAppData();
  // The Block button's choices are named on the household's clock, so the setting waits for it.
  const edit = useGroupEdit({ group, store, request, accounts, rules, timezone: household?.timezone ?? null, demo });
  const [confirming, setConfirming] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  // The sheet opens in its name field, and comes back to it from the delete question.
  useEffect(() => {
    if (!confirming) form.current?.querySelector("input")?.focus();
  }, [confirming]);

  // Focus goes back to the Edit button that opened the sheet (the dialog frame closes it on Escape).
  useEffect(() => {
    return () => {
      // Strict Mode remounts the sheet at once: only a sheet that is really gone hands focus back.
      window.setTimeout(() => {
        if (opener?.isConnected && !document.querySelector('[role="dialog"]')) opener.focus();
      }, 0);
    };
  }, [opener]);

  if (confirming) {
    const copy = deleteGroupConfirm(group, rulesOnlyFor(group, rules));
    return (
      <SheetFrame
        title={copy.title}
        sub={copy.body}
        size="confirm"
        onClose={onClose}
        footer={
          <>
            <button type="button" autoFocus onClick={() => setConfirming(false)} className={CANCEL_BUTTON}>
              {copy.cancel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void deleteGroup(store.mutate, group, onDeleted)}
              className={DESTRUCTIVE_BUTTON}
            >
              {copy.confirm}
            </button>
          </>
        }
      />
    );
  }

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
            className="mr-auto py-2 text-[14px] font-semibold text-[var(--ff-danger)] disabled:opacity-[var(--ff-disabled-opacity)]"
          >
            {GROUP_EDIT_COPY.delete}
          </button>
          <button type="button" onClick={onClose} className={CANCEL_BUTTON}>
            {GROUP_EDIT_COPY.cancel}
          </button>
          <button type="submit" form="group-edit-form" disabled={busy || !edit.dirty} className={PRIMARY_BUTTON}>
            {busy ? GROUP_EDIT_COPY.saving : GROUP_EDIT_COPY.save}
          </button>
        </>
      }
    >
      <form
        id="group-edit-form"
        ref={form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void edit.save().then((saved) => saved && onClose());
        }}
      >
        <GroupEditForm edit={edit} />
      </form>
    </SheetFrame>
  );
}
