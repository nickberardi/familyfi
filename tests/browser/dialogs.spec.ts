import { expect, test, type Page } from "@playwright/test";

const username = process.env.FAMILYFI_RECOVERY_USERNAME ?? "admin";
const password = process.env.FAMILYFI_DEFAULT_PASSWORD;

async function signIn(page: Page) {
  test.skip(!password, "FAMILYFI_DEFAULT_PASSWORD is required for browser tests");
  const login = await page.request.post("/api/v1/auth/login", {
    data: { username, password, client: "browser" },
  });
  if (!login.ok()) throw new Error(`login failed (${login.status()})`);
}

test("turning off the resolver's checking asks first, and Escape keeps it on", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  await page.goto("/categories");
  const card = page.getByTestId("resolver-card");
  const checking = card.getByRole("switch", { name: "Checking" });
  await expect(checking).toBeVisible();
  // The seed household may start with checking off; turning it on never asks.
  if ((await checking.getAttribute("aria-checked")) === "false") {
    await checking.click();
    await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
    await expect(checking).toHaveAttribute("aria-checked", "true");
  }

  const writes: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "PUT" && sent.url().includes("/api/v1/upstream/resolver")) writes.push(sent.postData() ?? "");
  });

  // Escape answers Cancel: nothing is sent and checking stays on.
  await checking.click();
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog.getByRole("heading", { name: "Turn off checking?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(checking).toHaveAttribute("aria-checked", "true");
  expect(writes).toHaveLength(0);

  // Turning it off says the results go; turning it back on does not ask.
  await checking.click();
  await dialog.getByRole("button", { name: "Turn off checking" }).click();
  await expect(checking).toHaveAttribute("aria-checked", "false");
  await expect(card.getByText("Paused — earlier results cleared")).toBeVisible();
  await checking.click();
  await expect(dialog).toBeHidden();
  await expect(checking).toHaveAttribute("aria-checked", "true");
  expect(writes.map((body) => JSON.parse(body))).toEqual([{ probeEnabled: false }, { probeEnabled: true }]);
});

test("going Back declines a question the page asked", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  await page.goto("/family");
  await page.goto("/devices");
  const remove = page.getByRole("button", { name: /^Delete / }).first();
  await expect(remove).toBeVisible();
  const label = await remove.getAttribute("aria-label");

  let deletes = 0;
  page.on("request", (sent) => {
    if (sent.method() === "DELETE" && sent.url().includes("/api/v1/devices/")) deletes += 1;
  });
  await remove.click();
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog.getByRole("button", { name: "Remove device" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/family$/);
  await expect(dialog).toBeHidden();
  await page.goForward();
  await expect(page.getByRole("button", { name: label! })).toBeVisible();
  expect(deletes).toBe(0);
});
