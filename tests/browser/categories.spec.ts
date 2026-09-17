import { expect, test, type Page } from "@playwright/test";

const username = process.env.FAMILYFI_RECOVERY_USERNAME ?? "admin";
const password = process.env.FAMILYFI_DEFAULT_PASSWORD;

async function signIn(page: Page) {
  test.skip(!password, "FAMILYFI_DEFAULT_PASSWORD is required for browser tests");
  const login = await page.request.post("/api/v1/auth/login", {
    data: { username, password, client: "browser" },
  });
  if (!login.ok()) {
    const body = (await login.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`login failed (${login.status()}): ${body.error?.message ?? "no error body"}`);
  }
}

test("Categories lists the seeded set and states the reporting-only stance", async ({ page }) => {
  await signIn(page);
  await page.goto("/categories");

  await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();

  // The stance is load-bearing copy: these verdicts never create a policy, and the
  // switch only turns checking on or off.
  await expect(page.getByText(/never creates a policy from these/i)).toBeVisible();
  await expect(page.getByText(/never blocks or unblocks anything/i)).toBeVisible();

  // Nine seeded categories, each linking to its detail page.
  const links = page.locator("a[href^='/categories/']");
  await expect(links).toHaveCount(9);
  await expect(page.getByText("Adult", { exact: true })).toBeVisible();
  await expect(page.getByText("Video", { exact: true })).toBeVisible();

  // The endpoint card explains why nothing is checked yet rather than showing a verdict.
  await expect(page.getByText("DNS-over-HTTPS endpoint")).toBeVisible();
});

test("a seeded domain strikes through on remove and comes back on restore", async ({ page }) => {
  await signIn(page);
  await page.goto("/categories");
  await page.locator("a[href^='/categories/']").first().click();

  await expect(page.getByText(/Built-in category/i)).toBeVisible();
  await expect(page.getByText(/A full pass takes about/i)).toBeVisible();

  // Leave the category as we found it: restore anything already struck first.
  while (await page.getByRole("button", { name: "Restore" }).count()) {
    const before = await page.getByRole("button", { name: "Restore" }).count();
    await page.getByRole("button", { name: "Restore" }).first().click();
    await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(before - 1);
  }

  const removes = page.getByRole("button", { name: "Remove" });
  const total = await removes.count();
  expect(total).toBeGreaterThan(0);

  await removes.first().click();

  // Kept on record and struck through, not deleted — that is what makes it restorable.
  await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(total - 1);
  await expect(page.locator("span[style*='line-through']")).toHaveCount(1);

  await page.getByRole("button", { name: "Restore" }).first().click();
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(total);
  await expect(page.locator("span[style*='line-through']")).toHaveCount(0);
});

test("a custom category is created report-only and can be deleted", async ({ page }) => {
  await signIn(page);
  await page.goto("/categories");

  const label = `Zz Browser ${Date.now()}`;
  await page.getByRole("button", { name: "New category" }).click();
  await page.getByLabel("Category name").fill(label);
  await page.getByRole("button", { name: "Create category" }).click();

  await expect(page.getByText(label, { exact: true })).toBeVisible();

  await page.getByText(label, { exact: true }).click();
  // Custom categories say so, and are the only ones that offer deletion.
  await expect(page.getByText(/Custom category — report-only/i)).toBeVisible();
  await page.getByRole("button", { name: "Delete category" }).click();

  await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();
  await expect(page.getByText(label, { exact: true })).toHaveCount(0);
});

test("a built-in category offers no delete", async ({ page }) => {
  await signIn(page);
  await page.goto("/categories");
  await page.locator("a[href^='/categories/']").first().click();

  await expect(page.getByText(/Built-in category/i)).toBeVisible();
  // Deleting one would be undone by the boot reconcile, so the affordance is absent.
  await expect(page.getByRole("button", { name: "Delete category" })).toHaveCount(0);
});
