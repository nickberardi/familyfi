import type { Page } from "@playwright/test";

/**
 * Chromium fails a navigation with `net::ERR_NETWORK_CHANGED` when the host's network interfaces
 * change while it loads, even for a page on 127.0.0.1. On a shared self-hosted runner, another
 * job starting or stopping a Docker network does that. It says nothing about FamilyFi, and it
 * failed the v0.43.1 Release run on a retry-passed smoke test. `page.goto` here tries once more
 * after that one error, so the navigation is judged on what the app serves. Any other failure,
 * and a second network change, still fails the test.
 * Only `page.goto` is covered: a reload or a click that navigates still fails on it.
 */
export const NETWORK_CHANGED = "net::ERR_NETWORK_CHANGED";

export function retryOnNetworkChange<T extends Pick<Page, "goto">>(page: T): T {
  const goto = page.goto.bind(page);
  page.goto = async (url, options) => {
    try {
      return await goto(url, options);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes(NETWORK_CHANGED)) throw error;
      return goto(url, options);
    }
  };
  return page;
}
