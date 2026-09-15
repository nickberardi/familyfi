import { expect, test, type Page } from "@playwright/test";

const password = process.env.DEFAULT_PASSWORD;
const username = "admin";

test.beforeAll(async ({ request }) => {
  const health = await request.get("/api/v1/health");
  if (!health.ok()) {
    throw new Error(`FamilyFi is not reachable (${health.status()}). Start make dev or set PLAYWRIGHT_BASE_URL.`);
  }
});

async function signIn(page: Page) {
  test.skip(!password, "DEFAULT_PASSWORD is required for browser tests");
  const login = await page.request.post("/api/v1/auth/login", {
    data: { username, password, client: "browser" },
  });
  if (!login.ok()) {
    const body = (await login.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`login failed (${login.status()}): ${body.error?.message ?? "no error body"}`);
  }
}

test("sign-in and household pages", async ({ page }) => {
  test.skip(!password, "DEFAULT_PASSWORD is required for browser tests");
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "FamilyFi" })).toBeVisible();
  await expect(page.getByText(/v0\.\d+\.\d+/)).toBeVisible();
  const usernameBox = page.getByLabel("Username");
  await expect(usernameBox).toHaveCSS("font-size", "16px");

  await signIn(page);
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
  await signIn(page);

  const name = `QA ${test.info().project.name} ${Date.now()}`;
  await page.goto("/family/new");
  await expect(page.getByRole("heading", { name: "Add person" })).toBeVisible();
  await expect(page.getByText("Loading household…")).toHaveCount(0);
  await page.getByLabel("Name").fill(name);
  const created = page.waitForResponse(
    (response) => response.url().includes("/api/v1/groups") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create" }).click();
  expect((await created).ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/family\/(?!new$)[^/]+$/);
  await expect(page.getByText("Group not found.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

  const renamed = `${name} Jr`;
  await page.getByLabel("Name").fill(renamed);
  const editHeading = page.getByRole("heading", { name: "Edit" });
  const yBefore = (await editHeading.boundingBox())?.y;
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"] .pointer-events-auto')).toBeVisible();
  expect((await editHeading.boundingBox())?.y).toBe(yBefore);

  await page.getByLabel(/Protected/).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Protected groups do not use Pause or bedtime.")).toBeVisible();

  await page.goto("/family/does-not-exist");
  await expect(page.getByText("Loading household…")).toHaveCount(0);
  await expect(page.getByText("Group not found.")).toBeVisible();
});

test("create things group lands on a seeded detail page that can be edited", async ({ page }) => {
  await signIn(page);

  const name = `Things ${test.info().project.name} ${Date.now()}`;
  await page.goto("/things/new");
  await expect(page.getByRole("heading", { name: "Add Things group" })).toBeVisible();
  await expect(page.getByText("Loading household…")).toHaveCount(0);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Monogram").fill("QA");
  const created = page.waitForResponse(
    (response) => response.url().includes("/api/v1/groups") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create" }).click();
  expect((await created).ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/things\/(?!new$)[^/]+$/);
  await expect(page.getByText("Group not found.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

  await page.getByLabel("Monogram").fill("TV");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Monogram")).toHaveValue("TV");
});

test("device assignment updates immediately", async ({ page }) => {
  await signIn(page);

  await page.goto("/devices");
  await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible();
  await expect(page.getByText("Loading household…")).toHaveCount(0);
  const select = page.locator("select").first();
  test.skip((await select.count()) === 0, "No devices in this household");
  const current = await select.inputValue();
  const groups = await page.request.get("/api/v1/groups");
  const body = (await groups.json()) as { groups: { id: string; name: string }[] };
  const target = body.groups.find((group) => group.id !== current) ?? body.groups[0];
  if (!target) test.skip(true, "No groups to assign");
  await select.selectOption(target.id);
  await expect(select).toHaveValue(target.id);
});
