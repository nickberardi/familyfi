import { PAIR_COPY, appStoreLinks } from "@/lib/pair-device";
import { SECONDARY_BUTTON } from "./SheetFrame";

/** Where to get the FamilyFi app before pairing a phone, one link per store that has one. */
export function AppStoresCard() {
  const stores = appStoreLinks();
  if (stores.length === 0) return null;
  return (
    <section data-testid="app-stores" className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <div className="flex flex-wrap items-center gap-3 px-[18px] py-[15px]">
        <div className="min-w-[200px] flex-1">
          <div className="text-[14px] font-semibold">{PAIR_COPY.getApp}</div>
          <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">{PAIR_COPY.getAppSub}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {stores.map((store) => (
            <a key={store.id} className={SECONDARY_BUTTON} href={store.url} target="_blank" rel="noreferrer" title={store.devices}>
              {store.label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
