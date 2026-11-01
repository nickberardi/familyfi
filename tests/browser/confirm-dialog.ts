import type { Page } from "@playwright/test";

/**
 * The web asks before a destructive or disruptive step in its own dialog, not the browser's
 * `confirm()`. `answerConfirm` waits for the next one and answers it; `answerConfirms` answers
 * every one the page asks from then on, as `page.on("dialog")` did. Each hands back the
 * question as one line: the title, then the consequence.
 */
export async function answerConfirm(page: Page, go = true): Promise<string> {
  const dialog = page.getByTestId("confirm-dialog");
  await dialog.waitFor();
  const asked = (await dialog.getByRole("heading").textContent()) + " " + (await dialog.locator("p").first().textContent());
  await dialog.getByRole("button").nth(go ? 1 : 0).click();
  await dialog.waitFor({ state: "hidden" });
  return asked;
}

export async function answerConfirms(page: Page, onAsk?: (asked: string) => void) {
  // Playwright runs the handler whenever the dialog is up before an action or an auto-waiting
  // assertion, so a step that asks is answered before the test looks at its result.
  await page.addLocatorHandler(page.getByTestId("confirm-dialog"), async () => {
    const asked = await answerConfirm(page);
    onAsk?.(asked);
  });
}
