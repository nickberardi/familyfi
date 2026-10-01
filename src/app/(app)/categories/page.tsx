"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/api";
import { CATEGORIES_COPY as COPY, loadUpstreamCategories, runAllChecks, setCategoryChecking } from "@/lib/upstream-writes";
import type { UpstreamCategoryRow, UpstreamResolverSettings } from "@/lib/upstream";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { NewCategorySheet } from "@/components/upstream/NewCategorySheet";
import { CategoriesList, CategoriesStance } from "@/ui/CategoriesList";
import { ResolverCard } from "@/ui/ResolverCard";

export default function CategoriesPage() {
  const { household } = useAppData();
  const [categories, setCategories] = useState<UpstreamCategoryRow[]>([]);
  const [resolver, setResolver] = useState<UpstreamResolverSettings | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Same race guard as the Rules page: categories are page-owned, not in the provider.
  const loadGen = useRef(0);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    try {
      const next = await loadUpstreamCategories(request);
      if (gen !== loadGen.current) return;
      setCategories(next.categories);
      setResolver(next.resolver);
    } catch (err) {
      if (gen !== loadGen.current) return;
      setError(err instanceof Error ? err.message : COPY.loadFailed);
    }
  }, []);

  // Deferred and cancel-on-unmount, the same shape the Rules page uses.
  useEffect(() => {
    const start = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(start);
      loadGen.current += 1;
    };
  }, [load]);

  async function toggleEnabled(category: UpstreamCategoryRow) {
    setBusy(true);
    setError("");
    try {
      await setCategoryChecking(request, category, !category.enabled);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.toggleFailed);
    } finally {
      setBusy(false);
    }
  }

  async function runSweep() {
    setBusy(true);
    setError("");
    try {
      await runAllChecks(request);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.sweepFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={COPY.title} sub={COPY.subtitle} actionLabel={COPY.newCategory} onAction={() => setNewOpen(true)} />
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <CategoriesStance />

        <ResolverCard resolver={resolver} request={request} timezone={household?.timezone ?? "America/New_York"} onChanged={() => void load()} />

        {error ? (
          <p className="m-0 text-[13px]" style={{ color: "var(--ff-danger)" }}>
            {error}
          </p>
        ) : null}

        <CategoriesList categories={categories} busy={busy} onCheckAll={() => void runSweep()} onToggle={(category) => void toggleEnabled(category)} />
      </div>

      {newOpen ? <NewCategorySheet onClose={() => setNewOpen(false)} onCreated={() => void load()} /> : null}
    </>
  );
}
