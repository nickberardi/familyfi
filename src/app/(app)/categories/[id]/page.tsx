"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { request } from "@/lib/api";
import type { UpstreamCategoryRow } from "@/lib/upstream";
import { CATEGORIES_COPY, loadUpstreamCategory } from "@/lib/upstream-writes";
import { CategoryDetailContent } from "@/ui/CategoryDetailContent";

const COPY = CATEGORIES_COPY.detail;

export default function CategoryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const [category, setCategory] = useState<UpstreamCategoryRow | null>(null);
  const [error, setError] = useState("");

  const loadGen = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    const gen = ++loadGen.current;
    try {
      const next = await loadUpstreamCategory(request, id);
      if (gen !== loadGen.current) return;
      setCategory(next);
    } catch (err) {
      if (gen !== loadGen.current) return;
      setError(err instanceof Error ? err.message : COPY.loadFailed);
    }
  }, [id]);

  // Deferred and cancel-on-unmount, the same shape the Rules page uses.
  useEffect(() => {
    const start = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(start);
      loadGen.current += 1;
    };
  }, [load]);

  if (!category) {
    return (
      <div className="px-4 py-6 md:px-6">
        {error ? (
          <p className="m-0 text-[13px]" style={{ color: "var(--ff-danger)" }}>
            {error}
          </p>
        ) : (
          <p className="m-0 text-[13px]" style={{ color: "var(--ff-ink-3)" }}>
            {COPY.loading}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
      <Link
        href="/categories"
        className="w-fit text-[13.5px] font-semibold no-underline"
        style={{ color: "var(--ff-accent)" }}
      >
        {COPY.back}
      </Link>
      <CategoryDetailContent category={category} request={request} onChanged={load} onDeleted={() => router.push("/categories")} />
      {error ? (
        <p className="m-0 text-[13px]" style={{ color: "var(--ff-danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
