"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/api";
import { CATEGORIES_COPY as COPY, loadUpstreamCategories, runAllChecks, setCategoryChecking } from "@/lib/upstream-writes";
import {
  effectiveCheck,
  verdictDetailText,
  verdictStyle,
  type UpstreamCategoryRow,
  type UpstreamResolverSettings,
} from "@/lib/upstream";
import { PageHeader } from "@/components/PageHeader";
import { TogglePill } from "@/components/ui/Controls";
import { MonoTile } from "@/components/ui/MonoTile";
import { upstreamCategoryIcon } from "@/lib/upstream-domains";
import { NewCategorySheet } from "@/components/upstream/NewCategorySheet";
import { ResolverCard } from "@/components/upstream/ResolverCard";

export default function CategoriesPage() {
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
      <PageHeader
        title={COPY.title}
        sub={COPY.subtitle}
        actionLabel={COPY.newCategory}
        onAction={() => setNewOpen(true)}
      />
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        {/*
          The stance, stated where it is acted on. These verdicts never create a
          policy, and the switch only turns checking on or off.
        */}
        <p className="m-0 max-w-[74ch] text-[12.5px] leading-relaxed" style={{ color: "var(--ff-ink-3)" }}>
          {COPY.stance}
        </p>

        <ResolverCard resolver={resolver} onChanged={() => void load()} />

        {error ? (
          <p className="m-0 text-[13px]" style={{ color: "var(--ff-danger)" }}>
            {error}
          </p>
        ) : null}

        <section
          className="overflow-hidden rounded-[12px]"
          style={{ background: "var(--ff-card)", border: "1px solid var(--ff-hairline-card)" }}
        >
          <div
            className="flex items-center gap-3 px-[18px] py-[15px]"
            style={{ borderBottom: "1px solid var(--ff-hairline-card)" }}
          >
            <span className="flex-1 text-[14px] font-semibold">
              {COPY.count(categories.length)}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runSweep()}
              className="rounded-lg px-3 py-[7px] text-[12.5px] font-semibold disabled:opacity-40"
              style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-ink)" }}
            >
              {COPY.checkAll}
            </button>
          </div>

          {categories.map((category) => {
            // This page is the household context, so no group is passed.
            const check = effectiveCheck(category.checks);
            const style = verdictStyle(check);
            return (
              <div
                key={category.id}
                className="flex flex-wrap items-center gap-1.5 px-3 py-3 md:gap-3 md:px-[18px]"
                style={{ borderTop: "1px solid var(--ff-hairline)" }}
              >
                <MonoTile
                  monogram={category.monogram}
                  source={category.source}
                  icon={upstreamCategoryIcon(category.slug, category.source)}
                />
                <Link
                  href={`/categories/${category.id}`}
                  className="min-w-[60px] flex-1 no-underline md:min-w-[140px]"
                  style={{ color: "var(--ff-ink)" }}
                >
                  <span className="block truncate text-[14px] font-semibold">{category.label}</span>
                  <span className="hidden text-[12px] md:block" style={{ color: "var(--ff-ink-3)" }}>
                    {COPY.rowDetail(category.activeDomainCount, verdictDetailText(check))}
                  </span>
                </Link>
                <span
                  className="flex-none rounded-[10px] px-[10px] py-[4px] text-[11.5px] font-semibold"
                  style={{ background: style.fill, color: style.ink, border: `1px solid ${style.line}` }}
                >
                  {style.label}
                </span>
                {/* Reads "On"/"Off", not "Checking" — it sits beside a verdict chip
                    that can itself read "Not checked", and the two must not blur. The
                    accessible name says which of the two this control is. */}
                <div className="ml-auto flex-none">
                  <TogglePill
                    on={category.enabled}
                    onToggle={() => void toggleEnabled(category)}
                    disabled={busy}
                    label={COPY.checkingLabel(category.label)}
                    title={COPY.checkingTitle}
                  />
                </div>
              </div>
            );
          })}
        </section>
      </div>

      {newOpen ? (
        <NewCategorySheet onClose={() => setNewOpen(false)} onCreated={() => void load()} />
      ) : null}
    </>
  );
}
