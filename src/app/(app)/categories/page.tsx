"use client";

import { useEffect, useState } from "react";
import { request } from "@/lib/api";
import { CATEGORIES_COPY as COPY } from "@/lib/upstream-writes";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { NewCategorySheet } from "@/components/upstream/NewCategorySheet";
import { CategoriesList, CategoriesStance } from "@/ui/CategoriesList";
import { ResolverCard } from "@/ui/ResolverCard";
import { useUpstreamCategories } from "@/ui/use-upstream-categories";

export default function CategoriesPage() {
  const { household } = useAppData();
  const { categories, resolver, error, busy, load, checkAll, toggle } = useUpstreamCategories(request);
  const [newOpen, setNewOpen] = useState(false);

  // Deferred and cancel-on-unmount, the same shape the Rules page uses.
  useEffect(() => {
    const start = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(start);
  }, [load]);

  return (
    <>
      <PageHeader title={COPY.title} sub={COPY.subtitle} actionLabel={COPY.newCategory} onAction={() => setNewOpen(true)} />
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <CategoriesStance />

        <ResolverCard resolver={resolver} request={request} timezone={household?.timezone ?? "America/New_York"} onChanged={() => void load()} />

        {error ? (
          <p className="m-0 text-[14px]" style={{ color: "var(--ff-danger)" }}>
            {error}
          </p>
        ) : null}

        <CategoriesList categories={categories ?? []} busy={busy} onCheckAll={checkAll} onToggle={toggle} />
      </div>

      {newOpen ? <NewCategorySheet onClose={() => setNewOpen(false)} onCreated={() => void load()} /> : null}
    </>
  );
}
