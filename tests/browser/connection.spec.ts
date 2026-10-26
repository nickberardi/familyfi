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

/** FamilyFi goes away: every API call fails without a response, as while it restarts for an update. */
const goAway = (page: Page) => page.route("**/api/v1/**", (route) => route.abort("connectionrefused"));
const comeBack = (page: Page) => page.unroute("**/api/v1/**");

test("says the household is out of date while FamilyFi can't be reached, until it is back", { tag: "@desktop" }, async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  await page.goto("/family");
  await expect(page.getByText("Cassie", { exact: true }).first()).toBeVisible();
  const banner = page.getByTestId("stale-banner");
  await expect(banner).toHaveCount(0);

  await goAway(page);
  await page.clock.fastForward(20_000);
  await expect(banner).toHaveText(/Can't reach FamilyFi\. What you see may be out of date\./);
  // The last update stays on screen.
  await expect(page.getByText("Cassie", { exact: true }).first()).toBeVisible();

  await comeBack(page);
  await banner.getByRole("button", { name: "Try again" }).click();
  await expect(banner).toHaveCount(0);
});

test("shows no household until one loads, rather than an empty one", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  await goAway(page);
  await page.goto("/family");
  const failed = page.getByTestId("load-failed");
  await expect(failed).toContainText("Couldn't load your household");
  await expect(failed).toContainText("Can't reach FamilyFi.");
  await expect(page.getByText("Nothing here yet")).toHaveCount(0);
  await expect(page.getByTestId("toast")).toHaveCount(0);

  await comeBack(page);
  await failed.getByRole("button", { name: "Try again" }).click();
  await expect(failed).toHaveCount(0);
  await expect(page.getByText("Cassie", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("toast")).toHaveCount(0);
});
