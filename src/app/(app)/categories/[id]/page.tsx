"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { request } from "@/lib/api";
import {
  activeDomainList,
  categoryCheckLine,
  domainListAfter,
  domainVerdictStyle,
  effectiveCheck,
  enabledNoteText,
  sourceNoteText,
  verdictStyle,
  type UpstreamCategoryRow,
} from "@/lib/upstream";
import {
  CATEGORIES_COPY,
  checkCategory,
  deleteCategory,
  loadUpstreamCategory,
  patchCategoryDomains,
  setCategoryChecking,
} from "@/lib/upstream-writes";

const COPY = CATEGORIES_COPY.detail;
import { MonoTile } from "@/components/ui/MonoTile";
import { upstreamCategoryIcon } from "@/lib/upstream-domains";
import { TextField, TogglePill } from "@/components/ui/Controls";
import { NetworkCheckDetails } from "@/components/upstream/NetworkCheckDetails";

export default function CategoryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const [category, setCategory] = useState<UpstreamCategoryRow | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [busy, setBusy] = useState(false);
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

  async function run(work: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Every domain edit is the same call: PATCH the whole active list. The server
   * decides whether leaving one out means strike it through (seeded) or delete it
   * (added here), so this page never has to know which case it is.
   */
  function patchDomains(domains: string[], failure: string) {
    return run(() => patchCategoryDomains(request, { id: id! }, domains), failure);
  }

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

  const check = effectiveCheck(category.checks);
  const style = verdictStyle(check);
  const active = activeDomainList(category.domains);

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
      <Link
        href="/categories"
        className="w-fit text-[13.5px] font-semibold no-underline"
        style={{ color: "var(--ff-accent)" }}
      >
        {COPY.back}
      </Link>

      <section
        className="rounded-[12px] p-[18px]"
        style={{ background: "var(--ff-card)", border: "1px solid var(--ff-hairline-card)" }}
      >
        <div className="flex flex-wrap items-center gap-3.5">
          <MonoTile
            monogram={category.monogram}
            source={category.source}
            icon={upstreamCategoryIcon(category.slug, category.source)}
            size="detail"
          />
          <div className="min-w-[200px] flex-1">
            <h1 className="m-0 text-[18px] font-bold tracking-tight">{category.label}</h1>
            <p className="mt-0.5 mb-0 text-[12.5px]" style={{ color: "var(--ff-ink-3)" }}>
              {sourceNoteText(category.source)}
            </p>
          </div>
          <span
            className="flex-none rounded-[10px] px-[11px] py-[5px] text-[12.5px] font-semibold"
            style={{ background: style.fill, color: style.ink, border: `1px solid ${style.line}` }}
          >
            {style.label}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() => checkCategory(request, category), COPY.checkFailed)
            }
            className="flex-none rounded-lg px-3.5 py-[7px] text-[12.5px] font-semibold disabled:opacity-40"
            style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-ink)" }}
          >
            {COPY.checkNow}
          </button>
        </div>
        <p className="mt-2 mb-0 text-[12.5px]" style={{ color: "var(--ff-ink-3)" }}>
          {categoryCheckLine(check)}
        </p>
        <NetworkCheckDetails check={check} />

        <div
          className="mt-3.5 flex flex-wrap items-center gap-2.5 pt-3.5"
          style={{ borderTop: "1px solid var(--ff-hairline)" }}
        >
          <TogglePill
            on={category.enabled}
            onToggle={() =>
              void run(() => setCategoryChecking(request, category, !category.enabled), CATEGORIES_COPY.toggleFailed)
            }
            disabled={busy}
            label={CATEGORIES_COPY.checkingLabel(category.label)}
            onLabel={COPY.checkingOn}
            offLabel={COPY.checkingOff}
          />
          <span className="text-[12.5px]" style={{ color: "var(--ff-ink-3)" }}>
            {enabledNoteText(category.enabled)}
          </span>
          <span className="flex-1" />
          {category.source === "user" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await deleteCategory(request, category);
                  router.push("/categories");
                }, COPY.deleteFailed)
              }
              className="text-[12.5px] font-semibold disabled:opacity-40"
              style={{ color: "var(--ff-danger)" }}
            >
              {COPY.deleteCategory}
            </button>
          ) : null}
        </div>
      </section>

      <section
        className="overflow-hidden rounded-[12px]"
        style={{ background: "var(--ff-card)", border: "1px solid var(--ff-hairline-card)" }}
      >
        <div
          className="px-[18px] py-[14px] text-[14px] font-semibold"
          style={{ borderBottom: "1px solid var(--ff-hairline-card)" }}
        >
          {COPY.domains}
        </div>

        {category.domains.map((domain) => {
          const domainStyle = domainVerdictStyle(domain, check);
          return (
            <div
              key={domain.id}
              className="flex items-center gap-3 px-[18px] py-2.5"
              style={{ borderTop: "1px solid var(--ff-hairline)" }}
            >
              <span
                className="min-w-0 flex-1 font-mono text-[13px]"
                style={{
                  textDecoration: domain.removed ? "line-through" : "none",
                  color: domain.removed ? "var(--ff-ink-struck)" : "var(--ff-ink)",
                }}
              >
                {domain.domain}
              </span>
              <span
                className="flex-none rounded-[10px] px-[10px] py-[4px] text-[11.5px] font-semibold"
                style={{
                  background: domainStyle.fill,
                  color: domainStyle.ink,
                  border: `1px solid ${domainStyle.line}`,
                }}
              >
                {domainStyle.label}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void patchDomains(domainListAfter(active, domain), domain.removed ? COPY.restoreFailed : COPY.removeFailed)
                }
                className="flex-none text-[12.5px] font-semibold disabled:opacity-40"
                style={{ color: "var(--ff-accent)" }}
              >
                {domain.removed ? COPY.restore : COPY.remove}
              </button>
            </div>
          );
        })}

        <div
          className="flex items-center gap-2.5 px-[18px] py-[13px]"
          style={{ borderTop: "1px solid var(--ff-hairline)" }}
        >
          <TextField
            label={COPY.addLabel}
            value={newDomain}
            onChange={setNewDomain}
            placeholder={COPY.addPlaceholder}
            mono
            onSubmit={() => {
              const value = newDomain.trim();
              if (!value) return;
              void patchDomains([...active, value], COPY.addFailed).then(() => setNewDomain(""));
            }}
          />
          <button
            type="button"
            disabled={busy || !newDomain.trim()}
            onClick={() => {
              const value = newDomain.trim();
              if (!value) return;
              void patchDomains([...active, value], COPY.addFailed).then(() => setNewDomain(""));
            }}
            className="flex-none rounded-lg px-3.5 py-2 text-[13px] font-semibold disabled:opacity-40"
            style={{ background: "var(--ff-accent)", color: "var(--ff-ink-on-fill)" }}
          >
            {COPY.add}
          </button>
        </div>

        {/* Lists are uncapped by decision; this is how growth is priced. */}
        <p className="m-0 px-[18px] pb-[14px] pt-0.5 text-[12px]" style={{ color: "var(--ff-ink-4)" }}>
          {category.costNote}
        </p>
      </section>

      {error ? (
        <p className="m-0 text-[13px]" style={{ color: "var(--ff-danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
