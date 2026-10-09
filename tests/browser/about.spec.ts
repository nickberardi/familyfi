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

test("opens About from the rail's version and its lockup, and closes on Done and Escape", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  await page.goto("/family");

  // The lockup and the version under the account card are both "About FamilyFi".
  const openers = page.getByRole("button", { name: "About FamilyFi" });
  await expect(openers).toHaveCount(2);
  await expect(openers.last()).toHaveText(/^v\d+\.\d+\.\d+/);

  await openers.last().click();
  const about = page.getByRole("dialog", { name: "About FamilyFi" });
  await expect(about.getByText("Business Source License 1.1")).toBeVisible();
  await expect(about.getByRole("link", { name: "View source" })).toHaveAttribute("href", "https://github.com/nickberardi/familyfi");
  await expect(about.getByText(/^v\d+\.\d+\.\d+/)).toBeVisible();
  // Outside the demo there is nothing to install, so no "Get started" tab.
  await expect(about.getByRole("button", { name: "Get started" })).toHaveCount(0);
  await about.getByRole("button", { name: "Done" }).click();
  await expect(about).toHaveCount(0);

  await openers.first().click();
  await expect(about).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(about).toHaveCount(0);
});

test("opens About from the drawer and closes the drawer behind it", { tag: "@phone" }, async ({ page }) => {
  await signIn(page);
  await page.goto("/family");

  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await drawer.getByRole("button", { name: "About FamilyFi" }).last().click();

  await expect(page.getByRole("dialog", { name: "About FamilyFi" })).toBeVisible();
  await expect(drawer).toHaveCount(0);
});
