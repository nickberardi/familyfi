import Image from "next/image";
import { APP_STORES, APP_STORE_SOON, PAIR_COPY, type AppStore } from "@/lib/pair-device";

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

/** Where to get the FamilyFi app before pairing a phone: each store's badge, linked once the store has a link. */
export function AppStoresCard() {
  return (
    <section data-testid="app-stores" className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <div className="flex flex-wrap items-center gap-3 px-[18px] py-[15px]">
        <div className="min-w-[200px] flex-1">
          <div className="text-[14px] font-semibold">{PAIR_COPY.getApp}</div>
          <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">{PAIR_COPY.getAppSub}</div>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {APP_STORES.map((store) =>
            store.url ? (
              <a key={store.id} href={store.url} target="_blank" rel="noreferrer">
                <Badge store={store} />
              </a>
            ) : (
              // The ribbon lies across the badge, so a store that isn't open yet takes the same space as one that is.
              <div key={store.id} className="relative overflow-hidden rounded-[6px]">
                <Badge store={store} soon />
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 left-1/2 w-[140%] -translate-x-1/2 -translate-y-1/2 -rotate-[10deg] bg-[var(--ff-accent)] text-center text-[14px] leading-5 font-semibold text-[var(--ff-ink-on-fill)]"
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
