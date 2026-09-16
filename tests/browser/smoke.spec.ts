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

  for (const path of ["/things", "/rules", "/devices", "/sync", "/settings", "/reference"]) {
    await page.goto(path);
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  }
  await expect(page).toHaveURL(/\/reference/);
  await expect(page.getByRole("heading", { name: "API" })).toBeVisible();

  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible();
  // Sidebar Rules link is desktop-only; phone bottom nav never included Schedules/Rules.
  if (test.info().project.name !== "phone") {
    await expect(page.getByRole("link", { name: "Rules" }).first()).toBeVisible();
  }

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
  await expect(page.locator('[aria-live="polite"] .pointer-events-auto')).toContainText("Saved.");
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
  await expect(select, "UNIFI_MOCK household must seed devices in CI").toHaveCount(1);
  const current = await select.inputValue();
  const groups = await page.request.get("/api/v1/groups");
  expect(groups.ok()).toBeTruthy();
  const body = (await groups.json()) as { groups: { id: string; name: string }[] };
  const target = body.groups.find((group) => group.id !== current) ?? body.groups[0];
  expect(target, "UNIFI_MOCK household must seed groups in CI").toBeTruthy();
  await select.selectOption(target!.id);
  await expect(select).toHaveValue(target!.id);
  await expect(page.locator('[aria-live="polite"] .pointer-events-auto')).toContainText("Saved.");
});

test("Rules shell: protected absent and Always|Scheduled persist", async ({ page }) => {
  await signIn(page);

  const groupsRes = await page.request.get("/api/v1/groups");
  expect(groupsRes.ok()).toBeTruthy();
  const body = (await groupsRes.json()) as {
    groups: {
      id: string;
      name: string;
      kind: string;
      protected: boolean;
      familyRole: string | null;
    }[];
  };

  const protectedGroup = body.groups.find((group) => group.protected);
  expect(protectedGroup, "UNIFI_MOCK seed must include a protected group").toBeTruthy();

  // Prefer distinct seeded kids per project to reduce desktop/phone schedule races.
  const preferredName = test.info().project.name === "phone" ? "Sam" : "Betsy";
  const child =
    body.groups.find((group) => !group.protected && group.kind === "family" && group.name === preferredName) ??
    body.groups.find(
      (group) =>
        !group.protected && group.kind === "family" && (group.familyRole === "child" || group.familyRole === "teen"),
    );
  expect(child, "UNIFI_MOCK seed must include a non-protected family child").toBeTruthy();

  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible();
  await expect(page.locator(`#group-${protectedGroup!.id}`)).toHaveCount(0);

  if (test.info().project.name !== "phone") {
    await expect(page.getByRole("link", { name: "Schedules" })).toHaveCount(0);
  }

  const row = page.locator(`#group-${child!.id}`);
  await expect(row).toBeVisible();
  await expect(row.getByText("Internet").filter({ visible: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "×" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: /delete/i })).toHaveCount(0);

  const modeOf = (scope: ReturnType<Page["locator"]>) =>
    scope.getByRole("group", { name: "Internet rule mode" }).filter({ visible: true });

  async function clickMode(enabled: boolean) {
    const mode = modeOf(page.locator(`#group-${child!.id}`));
    const label = enabled ? "Scheduled" : "Always";
    const put = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().includes(`/api/v1/groups/${child!.id}/schedule`),
    );
    await mode.getByRole("button", { name: label }).click();
    const res = await put;
    expect(res.ok()).toBeTruthy();
    expect((res.request().postDataJSON() as { enabled: boolean }).enabled).toBe(enabled);
  }

  async function expectMode(enabled: boolean) {
    const mode = modeOf(page.locator(`#group-${child!.id}`));
    await expect(mode.getByRole("button", { name: "Always" })).toHaveAttribute(
      "aria-pressed",
      enabled ? "false" : "true",
    );
    await expect(mode.getByRole("button", { name: "Scheduled" })).toHaveAttribute(
      "aria-pressed",
      enabled ? "true" : "false",
    );
  }

  // Seed starts scheduled; if a prior run left Always, nudge to Scheduled first so Always PUT fires.
  const initialScheduled =
    (await modeOf(row).getByRole("button", { name: "Scheduled" }).getAttribute("aria-pressed")) === "true";
  if (!initialScheduled) {
    await clickMode(true);
    await page.goto("/rules");
  }

  await clickMode(false);
  await page.goto("/rules");
  await expectMode(false);

  await clickMode(true);
  await page.goto("/rules");
  await expectMode(true);

  // Phase 3: Network chips from Settings managed networks (manage-all in UNIFI_MOCK seed).
  await page.getByRole("button", { name: "New rule" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New rule" })).toBeVisible();
  const networkTab = dialog.getByRole("button", { name: "Network" });
  await expect(networkTab).toBeEnabled();
  await networkTab.click();
  await expect(dialog.getByRole("group", { name: "Managed networks" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
});
