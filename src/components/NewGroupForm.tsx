"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAppData } from "@/components/AppDataProvider";
import type { Group } from "@/lib/types";

export function NewGroupForm({ kind }: { kind: "family" | "things" }) {
  const router = useRouter();
  const { mutate, busy } = useAppData();
  const [name, setName] = useState("");
  const [familyRole, setFamilyRole] = useState<"child" | "teen" | "adult">("child");
  const [monogram, setMonogram] = useState("");
  const [prot, setProt] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = await mutate(() =>
      api<{ group: Group; change: { changeId: string } }>("/api/v1/groups", {
        method: "POST",
        body: JSON.stringify({
          kind,
          name,
          familyRole: kind === "family" ? familyRole : undefined,
          monogram: monogram || undefined,
          protected: prot,
        }),
      }),
    );
    if (!result?.group) return;
    router.replace(kind === "family" ? `/family/${result.group.id}` : `/things/${result.group.id}`);
  }

  return (
    <form method="post" onSubmit={(event) => void onSubmit(event)} className="mx-auto flex max-w-lg flex-col gap-3 p-6">
      <h1 className="text-[21px] font-bold">Add {kind === "family" ? "person" : "Things group"}</h1>
      <label className="flex flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)]">
        Name
        <input required className="rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px]" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {kind === "family" ? (
        <label className="flex flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)]">
          Role
          <select className="rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px]" value={familyRole} onChange={(e) => setFamilyRole(e.target.value as "child" | "teen" | "adult")}>
            <option value="child">Child</option>
            <option value="teen">Teen</option>
            <option value="adult">Adult</option>
          </select>
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)]">
          Monogram
          <input maxLength={4} className="rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px]" value={monogram} onChange={(e) => setMonogram(e.target.value)} />
        </label>
      )}
      <label className="flex items-center gap-2 text-[14px]">
        <input type="checkbox" checked={prot} onChange={(e) => setProt(e.target.checked)} />
        Protected — FamilyFi will not block this group
      </label>
      <button type="submit" disabled={busy} className="rounded-[9px] bg-[var(--ff-accent)] py-3 text-[16px] font-semibold text-white disabled:opacity-50">
        Create
      </button>
    </form>
  );
}
