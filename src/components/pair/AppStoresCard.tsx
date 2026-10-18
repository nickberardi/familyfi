"use client";

import Image from "next/image";
import { useState } from "react";
import { PRIMARY_BUTTON, SECONDARY_BUTTON, SheetFrame } from "@/components/pair/SheetFrame";
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

/** A store's badge that opens its brief steps (Google Play's closed beta) in the pairing sheets' modal. */
function StepsBadge({ store }: { store: AppStore }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="block rounded-[6px] border-0 bg-transparent p-0">
        <Badge store={store} />
      </button>
      {open ? (
        <SheetFrame
          title={PLAY_BETA.title}
          sub={PLAY_BETA.sub}
          onClose={() => setOpen(false)}
          footer={
            <>
              {store.url ? (
                <a href={store.url} target="_blank" rel="noreferrer" className={`${SECONDARY_BUTTON} inline-flex items-center gap-1`}>
                  {PLAY_BETA.more}
                  <Icon name="arrow-square-out" size={14} />
                </a>
              ) : null}
              <button type="button" onClick={() => setOpen(false)} className={PRIMARY_BUTTON}>
                {PLAY_BETA.done}
              </button>
            </>
          }
        >
          <ol className="flex flex-col gap-2.5 text-[14px]">
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
        </SheetFrame>
      ) : null}
    </>
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
        <div className="flex flex-wrap items-start gap-3">
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
