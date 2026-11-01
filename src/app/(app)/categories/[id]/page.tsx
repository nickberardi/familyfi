"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { BackLink, DETAIL_PAGE } from "@/components/ui/BackLink";
import { NotFound } from "@/components/ui/NotFound";
import { request } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { sourceNoteText } from "@/lib/upstream";
import { Alert } from "@/ui/Alert";
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
  // A 404 is "not found"; anything else is a load that failed and can be tried again.
  const [missing, setMissing] = useState(false);

  const loadGen = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    const gen = ++loadGen.current;
    try {
      const next = await loadUpstreamCategory(request, id);
      if (gen !== loadGen.current) return;
      setCategory(next);
      setError("");
    } catch (err) {
      if (gen !== loadGen.current) return;
      setMissing(err instanceof ApiError && err.status === 404);
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

  const back = <BackLink href="/categories" label={COPY.back} />;
  if (!category) {
    if (!error) return null;
    if (missing) return <NotFound title={COPY.notFoundTitle} line={COPY.notFoundLine} back={{ href: "/categories", label: COPY.back }} />;
    return (
      <>
        <PageHeader title={COPY.title} />
        <div className={DETAIL_PAGE}>
          {back}
          <Alert tone="danger" role="alert" action={{ label: COPY.retry, onPress: () => void load() }}>
            {COPY.loadFailed}
          </Alert>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={category.label} sub={sourceNoteText(category.source)} />
      <div className={DETAIL_PAGE}>
        {back}
        <CategoryDetailContent category={category} request={request} onChanged={load} onDeleted={() => router.push("/categories")} named={false} />
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
      </div>
    </>
  );
}
