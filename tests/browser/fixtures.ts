import { test as base } from "@playwright/test";

import { retryOnNetworkChange } from "./network-change";

export { expect } from "@playwright/test";
export type { Locator, Page } from "@playwright/test";

/**
 * Every browser spec imports `test` from here rather than from `@playwright/test`, so its page
 * survives a host network change mid-navigation (`./network-change`).
 * `tests/unit/browser-fixtures.test.ts` checks both.
 */
export const test = base.extend({
  page: async ({ page }, provide) => {
    await provide(retryOnNetworkChange(page));
  },
});
