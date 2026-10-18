"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { APP_STORES, APP_STORE_SOON, PAIR_COPY, PLAY_BETA, type AppStore } from "@/lib/pair-device";

const BADGE_HEIGHT = 40;

function Badge({ store, soon = false }: { store: AppStore; soon?: boolean }) {
  return (
    <Image
      src={store.badge}
      alt={soon ? `${store.label}, ${APP_STORE_SOON.toLowerCase()}` : store.label}
      width={store.badgeWidth}
      height={BADGE_HEIGHT}
      unoptimized
      // Nick chose to dim the badge of a store that isn't open yet, an exception to the 0.7 alpha rule.
      className={`block flex-none ${soon ? "opacity-50" : ""}`}
      style={{ width: store.badgeWidth, height: BADGE_HEIGHT }}
    />
  );
}

/** A store's badge that opens its brief steps (Google Play's closed beta) under it. */
function StepsBadge({ store }: { store: AppStore }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = `app-store-steps-${store.id}`;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div
      ref={root}
      // Tabbing past the steps closes them, as a click outside does.
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !root.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        className="block rounded-[6px] border-0 bg-transparent p-0"
      >
        <Badge store={store} />
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={PLAY_BETA.title}
          className="absolute top-[calc(100%+8px)] left-0 z-[60] sm:right-0 sm:left-auto w-[300px] max-w-[calc(100vw-32px)] rounded-[10px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] p-4 text-[14px]"
          style={{ boxShadow: "var(--ff-shadow-toast)" }}
        >
          <div className="font-semibold">{PLAY_BETA.title}</div>
          <div className="mt-1 text-[var(--ff-muted)]">{PLAY_BETA.sub}</div>
          <ol className="mt-3 flex flex-col gap-2">
            {PLAY_BETA.steps.map((step, index) => (
              <li key={step.url} className="flex items-baseline gap-2">
                <span className="w-4 flex-none font-semibold text-[var(--ff-muted)]">{index + 1}.</span>
                <a href={step.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--ff-accent)]">
                  {step.text}
                  <Icon name="arrow-square-out" size={14} />
                </a>
              </li>
            ))}
          </ol>
          {store.url ? (
            <a href={store.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[var(--ff-muted)]">
              {PLAY_BETA.more}
              <Icon name="arrow-square-out" size={14} />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Where to get the FamilyFi app before pairing a phone: each store's badge, linked once the store has a link. */
export function AppStoresCard() {
  return (
    <section data-testid="app-stores" className="rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <div className="flex flex-wrap items-center gap-3 px-[18px] py-[15px]">
        <div className="min-w-[200px] flex-1">
          <div className="text-[14px] font-semibold">{PAIR_COPY.getApp}</div>
          <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">{PAIR_COPY.getAppSub}</div>
        </div>
        {/* The steps hang from the badge row: under its left end where the row wraps below the
            heading on a phone, under its right end beside it. */}
        <div className="relative flex flex-wrap items-start gap-3">
          {APP_STORES.map((store: AppStore) =>
            store.steps ? (
              <StepsBadge key={store.id} store={store} />
            ) : store.url ? (
              <a key={store.id} href={store.url} target="_blank" rel="noreferrer">
                <Badge store={store} />
              </a>
            ) : (
              // The ribbon lies across the badge, so a store that isn't open yet takes the same space as one that is.
              <div key={store.id} className="relative overflow-hidden rounded-[6px]">
                <Badge store={store} soon />
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-[var(--ff-accent)] text-center text-[14px] leading-5 font-semibold text-[var(--ff-ink-on-fill)]"
                >
                  {APP_STORE_SOON}
                </span>
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
