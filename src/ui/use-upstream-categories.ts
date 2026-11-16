"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiRequest } from "@/lib/api-client";
import type { UpstreamCategoryRow, UpstreamResolverSettings } from "@/lib/upstream";
import { CATEGORIES_COPY, loadUpstreamCategories, runAllChecks, setCategoryChecking } from "@/lib/upstream-writes";

/**
 * The Categories page behind each client's own frame: the household's DNS categories and resolver,
 * which the household store does not hold, and the page's two writes (check them all, and turn
 * one's checking on or off). The client loads as its page shows; every write reloads, and an
 * answer a newer load has overtaken is dropped. `request` must keep its identity between renders.
 */
export function useUpstreamCategories(
  request: ApiRequest,
  /** Runs with every reload after a change: the app's group cards follow the categories. */
  alsoReload?: () => unknown,
) {
  // Null until the first answer, so a client can say it is loading.
  const [categories, setCategories] = useState<UpstreamCategoryRow[] | null>(null);
  const [resolver, setResolver] = useState<UpstreamResolverSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const next = await loadUpstreamCategories(request);
      if (mine !== generation.current) return;
      setCategories(next.categories);
      setResolver(next.resolver);
      setLoadError("");
    } catch (err) {
      if (mine === generation.current) setLoadError(err instanceof Error ? err.message : CATEGORIES_COPY.loadFailed);
    }
  }, [request]);
  // Leaving drops a load still in flight.
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const changed = () => Promise.all([load(), alsoReload?.()]);
  async function run(work: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setWriteError("");
    try {
      await work();
      await changed();
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  return {
    categories,
    resolver,
    /** The last write's refusal, else why the list could not be read. */
    error: writeError || loadError,
    busy,
    load,
    /** Reloads after a change made elsewhere on the page, such as the resolver card's. */
    changed,
    checkAll: () => void run(() => runAllChecks(request), CATEGORIES_COPY.sweepFailed),
    toggle: (category: UpstreamCategoryRow) => void run(() => setCategoryChecking(request, category, !category.enabled), CATEGORIES_COPY.toggleFailed),
  };
}
