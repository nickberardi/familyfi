import { UNIFI_PAGE_LIMIT, type UnifiPage } from "./types";

export async function collectPages<T>(
  readPage: (offset: number, limit: number) => Promise<UnifiPage<T>>,
  limit = UNIFI_PAGE_LIMIT,
): Promise<T[]> {
  if (limit > UNIFI_PAGE_LIMIT) {
    throw new Error(`UniFi page limit must be at most ${UNIFI_PAGE_LIMIT}.`);
  }
  const items: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await readPage(offset, limit);
    items.push(...page.data);
    if (page.data.length === 0 || items.length >= page.totalCount) break;
    offset += page.limit || limit;
    if (offset <= 0) break;
  }
  return items;
}
