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
              <div key={store.id} className="flex flex-col items-center gap-1">
                <Badge store={store} soon />
                <span className="text-[14px] text-[var(--ff-muted)]">{APP_STORE_SOON}</span>
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
