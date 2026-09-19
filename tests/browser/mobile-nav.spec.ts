import { expect, test, type Page } from "@playwright/test";

const username = process.env.FAMILYFI_RECOVERY_USERNAME ?? "admin";
const password = process.env.FAMILYFI_DEFAULT_PASSWORD;

async function signIn(page: Page) {
  test.skip(!password, "FAMILYFI_DEFAULT_PASSWORD is required for browser tests");
  test.skip(test.info().project.name !== "phone", "The hamburger drawer only exists below the desktop breakpoint.");
  const login = await page.request.post("/api/v1/auth/login", {
    data: { username, password, client: "browser" },
  });
  if (!login.ok()) {
    const body = (await login.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`login failed (${login.status()}): ${body.error?.message ?? "no error body"}`);
  }
}

test("reaches every destination the desktop sidebar has, not just the old bottom bar's four", async ({ page }) => {
  await signIn(page);
  await page.goto("/family");

  await page.getByRole("button", { name: "Open navigation" }).click();
  // The hidden desktop sidebar carries the same content, so assertions scope to the
  // drawer's own dialog rather than an unqualified page-wide query.
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer.getByText("Household", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Network", { exact: true })).toBeVisible();
  await expect(drawer.getByText("System", { exact: true })).toBeVisible();
  // Rules, Categories, Sync and API had no way onto a phone screen before this drawer.
  for (const label of ["Rules", "Categories", "Sync", "API"]) {
    await expect(drawer.getByRole("link", { name: label })).toBeVisible();
  }

  await drawer.getByRole("link", { name: "Categories" }).click();
  await expect(page).toHaveURL(/\/categories/);
  await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();
  // Picking a destination closes the drawer, same as the design's `pickAndClose`.
  // Once closed the sidebar's own hidden copy is the only "Rules" link left in the
  // accessibility tree, and `display:none` excludes it — so this is a true zero.
  await expect(page.getByRole("link", { name: "Rules" })).toHaveCount(0);
});

test("closes on a tap outside it without navigating", async ({ page }) => {
  await signIn(page);
  await page.goto("/family");

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();

  // The scrim spans the full screen but sits under the drawer panel in stacking order
  // (same as the design), so only the strip beyond the panel's width is actually
  // clickable — the same strip a real tap "outside the drawer" would land on.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("expected a viewport for the phone project");
  await page.getByRole("button", { name: "Close navigation" }).click({ position: { x: viewport.width - 10, y: 10 } });
  await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/family/);
});

test("closes on a route change from outside the drawer", async ({ page }) => {
  await signIn(page);
  // Two real in-app history entries, so the browser back button below is a client-side
  // route change within the running app rather than a full unload.
  await page.goto("/family");
  await page.goto("/things");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/family/);
  await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
});
