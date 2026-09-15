import { expect, test } from "@playwright/test";

const password = process.env.DEFAULT_PASSWORD;
const username = "admin";

test.beforeAll(async ({ request }) => {
  const health = await request.get("/api/v1/health");
  if (!health.ok()) {
    throw new Error(`FamilyFi is not reachable (${health.status()}). Start make dev or set PLAYWRIGHT_BASE_URL.`);
  }
});

test("sign-in and household pages", async ({ page }) => {
  test.skip(!password, "DEFAULT_PASSWORD is required for browser tests");
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "FamilyFi" })).toBeVisible();
  await expect(page.getByText(/v0\.\d+\.\d+/)).toBeVisible();
  const usernameBox = page.getByLabel("Username");
  await expect(usernameBox).toHaveCSS("font-size", "16px");

  const login = await page.request.post("/api/v1/auth/login", {
    data: { username, password, client: "browser" },
  });
  if (!login.ok()) {
    const body = (await login.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`login failed (${login.status()}): ${body.error?.message ?? "no error body"}`);
  }
  await page.goto("/family");
  await expect(page).toHaveURL(/\/family/);
  await expect(page.getByRole("heading", { name: "Family" })).toBeVisible();

  for (const path of ["/things", "/schedules", "/devices", "/sync", "/settings", "/reference"]) {
    await page.goto(path);
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  }
  await expect(page).toHaveURL(/\/reference/);
  await expect(page.getByRole("heading", { name: "API" })).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("About")).toBeVisible();
  await expect(page.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
});

test("create person lands on a seeded detail page that can be edited", async ({ page }) => {
  test.skip(!password, "DEFAULT_PASSWORD is required for browser tests");
  const login = await page.request.post("/api/v1/auth/login", {
    data: { username, password, client: "browser" },
  });
  if (!login.ok()) {
    const body = (await login.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`login failed (${login.status()}): ${body.error?.message ?? "no error body"}`);
  }

  const name = `QA ${test.info().project.name} ${Date.now()}`;
  await page.goto("/family/new");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/family\/[^/]+$/);
  await expect(page.getByText("Group not found.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

  const renamed = `${name} Jr`;
  await page.getByLabel("Name").fill(renamed);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
});
