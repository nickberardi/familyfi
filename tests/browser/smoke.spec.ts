import { expect, test, type Locator, type Page } from "@playwright/test";
import type { UpdateCheck } from "@/lib/types";

const password = process.env.FAMILYFI_DEFAULT_PASSWORD;
const username = "admin";

test.beforeAll(async ({ request }) => {
  const health = await request.get("/api/v1/health");
  if (!health.ok()) {
    throw new Error(`FamilyFi is not reachable (${health.status()}). Start make dev or set PLAYWRIGHT_BASE_URL.`);
  }
});

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

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "familyfi_csrf")?.value;
  if (!csrf) throw new Error("missing familyfi_csrf cookie after login");
  return { "x-csrf-token": csrf, "content-type": "application/json" };
}

test("sign-in and household pages", async ({ page }) => {
  test.skip(!password, "FAMILYFI_DEFAULT_PASSWORD is required for browser tests");
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "FamilyFi" })).toBeVisible();
  await expect(page.getByText(/v0\.\d+\.\d+/)).toBeVisible();
  const usernameBox = page.getByLabel("Username");
  await expect(usernameBox).toHaveCSS("font-size", "16px");

  // Through the form, as a person signs in: a refused sign-in is reported, and Return submits. The
  // refusal is answered here, so no failure counts toward the sign-in throttle.
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "invalid_credentials", message: "Invalid username or password." } }),
    }),
  );
  await usernameBox.fill("admin");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByLabel("Password").press("Enter");
  await expect(page.getByTestId("sign-in-error")).toHaveText("Invalid username or password.");
  await page.unroute("**/api/v1/auth/login");
  await page.getByLabel("Password").fill(password!);
  await page.getByLabel("Password").press("Enter");
  await expect(page).toHaveURL(/\/family/);
  await expect(page.getByRole("heading", { name: "Family" })).toBeVisible();

  for (const path of ["/things", "/rules", "/devices", "/sync", "/settings", "/reference"]) {
    await page.goto(path);
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  }
  await expect(page).toHaveURL(/\/reference/);
  await expect(page.getByRole("heading", { name: "API", exact: true })).toBeVisible();

  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible();
  if (test.info().project.name === "phone") {
    // The sidebar is hidden on phone; Rules is reached through the hamburger drawer.
    // The hidden sidebar carries the same link, so this scopes to the drawer itself.
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer.getByRole("link", { name: "Rules" })).toBeVisible();
    await drawer.getByRole("link", { name: "Rules" }).click();
  } else {
    await expect(page.getByRole("link", { name: "Rules" }).first()).toBeVisible();
  }

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("About", { exact: true })).toHaveCount(0);
});

test("the sidebar's notices collapse into one row when the rail is short", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.goto("/family");
  const rail = page.locator("aside");
  const row = rail.locator("button[aria-haspopup=dialog]");
  // With room, the cards show in full.
  await expect(rail.getByTestId("sync-status")).toBeVisible();
  await expect(row).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 480 });
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(rail.getByTestId("sync-status")).toBeHidden();
  await row.click();
  const popover = rail.getByRole("dialog");
  await expect(popover.getByTestId("sync-status")).toBeVisible();
  await expect(popover).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(row).toBeFocused();

  await row.click();
  await expect(popover).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(popover).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 1200 });
  await expect(rail.getByTestId("sync-status")).toBeVisible();
  await expect(row).toHaveCount(0);
});

test("reconciling from the collapsed notices keeps the row, and Escape returns focus to it", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  // A failed sync, so its card offers Reconcile now; the write that follows changes what it says.
  await page.route("**/api/v1/sync", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.connectionStatus = "error";
    body.lastRun = { ...(body.lastRun ?? {}), status: "failed", error: "The gateway refused the policy." };
    await route.fulfill({ response, json: body });
  });
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto("/family");
  const rail = page.locator("aside");
  const row = rail.locator("button[aria-haspopup=dialog]");
  await row.click();
  const popover = rail.getByRole("dialog");
  await popover.getByTestId("sync-reconcile").click();
  await expect(popover.getByTestId("sync-reconcile")).toBeEnabled();
  await expect(popover).toBeVisible();
  // The button is disabled while the write runs, which drops focus; from the card, Escape returns it to the row.
  await popover.getByTestId("sync-reconcile").focus();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(row).toBeFocused();
});

test("the sidebar alerts an available update and stays quiet otherwise", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  // Tall enough that the rail shows its cards in full rather than collapsed into one row.
  await page.setViewportSize({ width: 1280, height: 1000 });
  let update: UpdateCheck = {
    status: "ok",
    available: true,
    currentVersion: "0.5.1",
    latestVersion: "0.6.0",
    releaseUrl: "https://github.com/nickberardi/familyfi/releases/tag/v0.6.0",
    releaseNotes: "## New\n- Pair Device page\n\n## Fixed\n- Quarantine pill wording",
    checkedAt: "2026-09-22T12:00:00.000Z",
    lastSuccessfulAt: "2026-09-22T12:00:00.000Z",
    error: null,
  };
  await page.route("**/api/v1/health", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        db: "ok",
        version: "0.5.1",
        revision: 0,
        update,
      }),
    });
  });
  await page.goto("/family");
  const alert = page.getByRole("region", { name: "Update available" });
  await expect(alert).toContainText("v0.6.0 is ready. You’re on v0.5.1.");
  await alert.getByRole("link", { name: "Update" }).click();
  await expect(page).toHaveURL(/\/update$/);
  const notes = page.getByRole("region", { name: "Release notes" });
  await expect(notes).toContainText("Pair Device page");
  await expect(notes.getByRole("link", { name: "View on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/nickberardi/familyfi/releases/tag/v0.6.0",
  );
  await expect(page.getByRole("button", { name: /Install v0\.6\.0/ })).toBeDisabled();

  // Settings no longer carries the update check; the alert is the one place it appears.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(alert).toBeVisible();

  update = {
    ...update,
    available: false,
    latestVersion: "0.5.1",
    releaseUrl: "https://github.com/nickberardi/familyfi/releases/tag/v0.5.1",
  };
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(alert).toHaveCount(0);

  update = {
    ...update,
    status: "error",
    available: null,
    latestVersion: null,
    releaseUrl: null,
    releaseNotes: null,
    error: "GitHub release check failed.",
  };
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(alert).toHaveCount(0);
});

/** Adds a group through the Add sheet on its grid, which stays put, and returns the new id. */
async function addGroup(page: Page, kind: "family" | "things", fill: (dialog: Locator) => Promise<void>, name: string) {
  await page.goto(`/${kind}`);
  await expect(page.getByText("Loading household…")).toHaveCount(0);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: kind === "family" ? "New family member" : "New group" });
  await expect(dialog).toBeVisible();
  await fill(dialog);
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/groups") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: kind === "family" ? "Add person" : "Create group" }).click();
  const response = await created;
  expect(response.ok()).toBeTruthy();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/${kind}$`));
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  return ((await response.json()) as { group: { id: string } }).group.id;
}

test("add person opens a sheet over Family, and the new person can be edited", async ({ page }) => {
  await signIn(page);

  const name = `QA ${test.info().project.name} ${Date.now()}`;
  const id = await addGroup(page, "family", (dialog) => dialog.getByLabel("Name").fill(name), name);
  await page.goto(`/family/${id}`);
  await expect(page.getByText("Group not found.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  // A new person has no internet rule, and the page says so rather than implying one.
  await expect(page.getByRole("heading", { name: "All internet · no rule" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause all internet" })).toBeVisible();
  // A child is offered one-tap schedules.
  await expect(page.getByRole("button", { name: "Bedtime 9 PM–7 AM" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Homework 3–6 PM" })).toBeVisible();

  const renamed = `${name} Jr`;
  await page.getByLabel("Name").fill(renamed);
  const editHeading = page.getByRole("heading", { name: "Edit" });
  const yBefore = (await editHeading.boundingBox())?.y;
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"] .pointer-events-auto')).toContainText("Saved.");
  expect((await editHeading.boundingBox())?.y).toBe(yBefore);

  // Groups can no longer be protected from FamilyFi.
  await expect(page.getByLabel(/Protected/)).toHaveCount(0);

  // An adult starts from a custom schedule only.
  await page.getByLabel("Role").selectOption("adult");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: "Custom schedule" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bedtime 9 PM–7 AM" })).toHaveCount(0);
  // Role never limits a control: an adult can be paused too. Only the suggested schedules differ.
  await expect(page.getByRole("button", { name: "Pause all internet" })).toBeVisible();

  await page.goto("/family/does-not-exist");
  await expect(page.getByText("Loading household…")).toHaveCount(0);
  await expect(page.getByText("Group not found.")).toBeVisible();
});

test("add things group opens a sheet over Things, and the new group can be edited", async ({ page }) => {
  await signIn(page);

  const name = `Things ${test.info().project.name} ${Date.now()}`;
  const id = await addGroup(
    page,
    "things",
    async (dialog) => {
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByLabel("Monogram").fill("qa");
      await expect(dialog.getByLabel("Monogram")).toHaveValue("QA");
    },
    name,
  );
  await page.goto(`/things/${id}`);
  await expect(page.getByText("Loading household…")).toHaveCount(0);
  await expect(page.getByText("Group not found.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

  await page.getByLabel("Monogram").fill("TV");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Monogram")).toHaveValue("TV");
});

test("desktop Sync summary keeps four cards on one row", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sync");
  const cards = page.getByText("App-owned policies", { exact: true }).locator("..").locator("..");
  await expect(cards.locator(":scope > div")).toHaveCount(4);
  const tops = await cards.locator(":scope > div").evaluateAll((items) =>
    items.map((item) => Math.round(item.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
});

test("Sync summary cards keep equal columns when a row breaks", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  // Three columns fit beside the sidebar here and four do not, so the last card starts a row alone.
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/sync");
  const cards = page.getByText("App-owned policies", { exact: true }).locator("..").locator("..");
  await expect(cards.locator(":scope > div")).toHaveCount(4);
  const widths = await cards.locator(":scope > div").evaluateAll((items) =>
    items.map((item) => Math.round(item.getBoundingClientRect().width)),
  );
  expect(new Set(widths).size).toBe(1);
});

test("a device opened from its group returns to that group", async ({ page }) => {
  await signIn(page);
  const { groups } = (await (await page.request.get("/api/v1/groups")).json()) as {
    groups: { id: string; kind: string; name: string }[];
  };
  const { devices } = (await (await page.request.get("/api/v1/devices")).json()) as {
    devices: { mac: string; groupId: string | null }[];
  };
  const device = devices.find((item) => groups.some((group) => group.id === item.groupId));
  expect(device, "the mock household has an assigned device").toBeTruthy();
  const group = groups.find((item) => item.id === device!.groupId)!;
  const groupPath = `/${group.kind}/${group.id}`;

  await page.goto(groupPath);
  await page.locator(`a[href^="/devices/${encodeURIComponent(device!.mac)}?from="]`).click();
  await expect(page.getByRole("link", { name: `‹ ${group.name}` })).toHaveAttribute("href", groupPath);

  await page.goto(`/devices/${encodeURIComponent(device!.mac)}`);
  await expect(page.getByRole("link", { name: "‹ All devices" })).toHaveAttribute("href", "/devices");
});

test("device assignment updates immediately", async ({ page }) => {
  await signIn(page);

  await page.goto("/devices");
  await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible();
  await expect(page.getByText("Loading household…")).toHaveCount(0);
  const select = page.locator("select").first();
  await expect(select, "The mock household must seed devices in CI").toHaveCount(1);
  const deleteButton = page.getByRole("button", { name: /^Delete .+ \([0-9A-F:]+\)$/ }).first();
  await expect(deleteButton).toBeVisible();
  const bounds = await deleteButton.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds && viewport && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width).toBe(true);
  const current = await select.inputValue();
  const groups = await page.request.get("/api/v1/groups");
  expect(groups.ok()).toBeTruthy();
  const body = (await groups.json()) as { groups: { id: string; name: string }[] };
  const target = body.groups.find((group) => group.id !== current) ?? body.groups[0];
  expect(target, "The mock household must seed groups in CI").toBeTruthy();
  await select.selectOption(target!.id);
  await expect(select).toHaveValue(target!.id);
  await expect(page.locator('[aria-live="polite"] .pointer-events-auto')).toContainText("Saved.");
});

test("device identity opens readable connection details", async ({ page }) => {
  await signIn(page);
  await page.goto("/devices");
  const link = page.getByRole("link", { name: /^View details for / }).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/devices\/[^/]+$/);
  const identity = page.getByRole("region", { name: "Device" });
  const connection = page.getByRole("region", { name: "Connection" });
  await expect(identity).toBeVisible();
  await expect(connection).toBeVisible();
  await expect(page.getByText("MAC address")).toBeVisible();
  await expect(page.getByText("Checked", { exact: true })).toBeVisible();
  const first = await identity.boundingBox();
  const second = await connection.boundingBox();
  expect(first && second).toBeTruthy();
  if (test.info().project.name === "phone") {
    expect(second!.y).toBeGreaterThan(first!.y + first!.height - 2);
  } else {
    expect(Math.abs(second!.y - first!.y)).toBeLessThan(2);
  }
});

test("Rules: a two-window internet rule across midnight, named in UniFi, on the card", async ({ page }) => {
  await signIn(page);

  const groupsRes = await page.request.get("/api/v1/groups");
  expect(groupsRes.ok()).toBeTruthy();
  const body = (await groupsRes.json()) as {
    groups: { id: string; name: string; kind: string; familyRole: string | null }[];
  };
  const adult = body.groups.find((group) => group.familyRole === "adult");
  expect(adult, "The mock seed must include an adult with no rules").toBeTruthy();
  // Distinct seeded kids per project, so desktop and phone never edit the same group.
  const preferredName = test.info().project.name === "phone" ? "Abby" : "Betsy";
  const child = body.groups.find((group) => group.kind === "family" && group.name === preferredName);
  expect(child, "The mock seed must include Betsy and Abby").toBeTruthy();
  const ruleName = `QA lights out ${test.info().project.name} ${Date.now() % 100000}`;

  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Schedules" })).toHaveCount(0);
  // Seeded household rules, with the kind stated in words.
  await expect(page.getByText("All internet · every device").first()).toBeVisible();
  // A group with no rules is not something to filter by; it is named as unfiltered.
  await expect(page.getByRole("navigation", { name: "Show rules for" }).getByRole("link", { name: adult!.name })).toHaveCount(0);
  await expect(page.getByText(new RegExp(`No rules: .*${adult!.name}`))).toBeVisible();

  await page.goto(`/rules/new?group=${child!.id}`);
  await expect(page.getByRole("heading", { name: "New rule" })).toBeVisible();
  // All internet can be always on for chosen groups, but never for a whole network.
  await expect(page.getByRole("group", { name: "When" }).getByRole("button", { name: "Always" })).toBeEnabled();
  await expect(page.getByText(/All internet can’t be blocked for a whole network/)).toBeVisible();
  const scope = page.getByRole("group", { name: "Applies to" });
  if (await scope.count()) await expect(scope.getByRole("button", { name: "Whole networks" })).toBeDisabled();
  await page.getByLabel("Rule name").fill(ruleName);
  await page.getByLabel("Window 1 name").fill("Bed");
  await page.getByRole("button", { name: "+ Add window" }).click();
  await page.getByLabel("Window 2 name").fill("Study");
  // "+ Add window" starts on weekdays; every day here, so the window is on today's bar on any day.
  const studyDaysOff = page.getByRole("group", { name: "Days" }).nth(1).locator('button[aria-pressed="false"]');
  for (let left = await studyDaysOff.count(); left > 0; left -= 1) await studyDaysOff.first().click();
  await expect(studyDaysOff).toHaveCount(0);
  // Two windows: each policy is named after the rule, then its window.
  await expect(page.getByText("Names in UniFi · one policy per window")).toBeVisible();
  await expect(page.getByText(`${ruleName} – Bed`)).toHaveCount(2);
  await expect(page.getByText(`${ruleName} – Study`)).toHaveCount(2);
  // The first window already crosses midnight (9 PM–7 AM); the second overlaps nothing.
  await expect(page.getByText(/overlap\./)).toHaveCount(0);

  const created = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/rules"),
  );
  await page.getByRole("button", { name: "Create rule" }).last().click();
  const createdRes = await created;
  expect(createdRes.ok()).toBeTruthy();
  const { rule } = (await createdRes.json()) as { rule: { id: string; policyNames: string[]; windows: { start: string; end: string }[] } };
  expect(rule.policyNames).toEqual([`FamilyFi ${ruleName} – Bed`, `FamilyFi ${ruleName} – Study`]);
  expect(rule.windows.map((window) => [window.start, window.end])).toEqual([
    ["21:00", "07:00"],
    ["15:00", "18:00"],
  ]);

  try {
    // Scoped to the child, the new rule is listed with both windows.
    await expect(page).toHaveURL(new RegExp(`/rules\\?group=${child!.id}`));
    await expect(page.getByRole("heading", { name: ruleName })).toBeVisible();

    // The card's internet zone shows both windows on today's bar, by name.
    await page.goto("/family");
    const card = page.locator("article").filter({ has: page.getByText(child!.name, { exact: true }) }).first();
    // Cards start closed: the header opens the zones.
    const bar = card.getByRole("group", { name: `${child!.name}’s internet today` });
    await expect(bar).toHaveCount(0);
    await card.locator("button[aria-expanded=false]").first().click();
    await expect(bar.getByRole("button", { name: /^Bed, / }).first()).toBeVisible();
    await bar.getByRole("button", { name: /^Study, / }).click();
    await expect(card.getByText(`${ruleName} rule · Study`)).toBeVisible();
  } finally {
    await page.request.delete(`/api/v1/rules/${rule.id}`, { headers: await csrfHeaders(page) });
  }
});

test("Rules: pause a rule from its card and resume it", async ({ page }) => {
  await signIn(page);
  const groupsRes = await page.request.get("/api/v1/groups");
  const body = (await groupsRes.json()) as { groups: { id: string; name: string; kind: string }[] };
  const preferredName = test.info().project.name === "phone" ? "Abby" : "Betsy";
  const child = body.groups.find((group) => group.kind === "family" && group.name === preferredName);
  expect(child, "The mock seed must include Betsy and Abby").toBeTruthy();
  const ruleName = `QA pause ${test.info().project.name} ${Date.now() % 100000}`;
  const created = await page.request.post("/api/v1/rules", {
    headers: await csrfHeaders(page),
    data: { name: ruleName, kind: "category", groupIds: [child!.id], targetIds: [4], mode: "always" },
  });
  expect(created.ok()).toBeTruthy();
  const { rule } = (await created.json()) as { rule: { id: string } };

  try {
    await page.goto(`/rules?group=${child!.id}`);
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: ruleName }) });
    await card.getByRole("button", { name: "Pause rule" }).click();
    await page.getByRole("button", { name: /For 30 minutes/ }).click();
    await expect(card.getByText(/^Paused until .* by /)).toBeVisible();
    // The toggle still reads On: pausing is not turning the rule off.
    await expect(card.getByRole("switch", { name: ruleName })).toBeChecked();

    await card.getByRole("button", { name: "Resume rule" }).click();
    await expect(card.getByText(/^Paused until/)).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Pause rule" })).toBeVisible();
  } finally {
    await page.request.delete(`/api/v1/rules/${rule.id}`, { headers: await csrfHeaders(page) });
  }
});

test("Rules: quarantine is a built-in rule that pauses from its card and resumes on Devices", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  try {
    await page.goto("/rules");
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Quarantine" }) });
    await expect(card.getByText("All internet · every unassigned device")).toBeVisible();
    await expect(card.getByText("Unassigned devices")).toBeVisible();
    // The mock household enforces quarantine; it is paused, never allowed.
    await expect(card.getByRole("switch", { name: "Quarantine" })).toBeChecked();
    await expect(card.getByRole("button", { name: "Allow now" })).toHaveCount(0);
    await card.getByRole("button", { name: "Pause rule" }).click();
    await page.getByRole("button", { name: /For 30 minutes/ }).click();
    await expect(card.getByText(/^Paused until .* by /)).toBeVisible();

    await page.goto("/devices");
    const quarantine = page.getByTestId("quarantine-card");
    await expect(quarantine.getByTestId("quarantine-paused")).toHaveText(/^Paused until .* by /);
    await quarantine.getByRole("button", { name: "Resume" }).click();
    await expect(quarantine.getByTestId("quarantine-paused")).toHaveCount(0);
  } finally {
    await page.request.post("/api/v1/rules/quarantine/resume", { headers: await csrfHeaders(page) });
  }
});

test("Pause all internet names its scope and can be undone", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  const groupsRes = await page.request.get("/api/v1/groups");
  const body = (await groupsRes.json()) as { groups: { id: string; name: string; kind: string; deviceCount: number }[] };
  // The TV group, so the family cards other tests use are left alone.
  const tv = body.groups.find((group) => group.name === "TV");
  expect(tv, "The mock seed must include the TV things group").toBeTruthy();

  // A no-internet window offers "Allow internet now" instead of a pause, so turn the
  // seeded TV rule off while this runs: the test must not depend on the time of day.
  const rulesRes = await page.request.get("/api/v1/rules");
  const { rules } = (await rulesRes.json()) as { rules: { id: string; kind: string; enabled: boolean; groupIds: string[] }[] };
  const internetRules = rules.filter((rule) => rule.kind === "internet" && rule.enabled && rule.groupIds.includes(tv!.id));
  const setEnabled = async (enabled: boolean) => {
    for (const rule of internetRules) {
      const response = await page.request.patch(`/api/v1/rules/${rule.id}`, { headers: await csrfHeaders(page), data: { enabled } });
      expect(response.ok()).toBeTruthy();
    }
  };
  await setEnabled(false);
  try {
    await page.goto(`/things/${tv!.id}`);
    const zone = page.getByRole("heading", { name: /^All internet · / });
    await expect(zone).toBeVisible();
    await page.getByRole("button", { name: "Pause all internet" }).click();
    const sheet = page.getByRole("dialog", { name: `Pause all internet for ${tv!.name}?` });
    await expect(sheet).toBeVisible();
    // The confirmation names a device and says the other rules keep applying.
    const devicesRes = await page.request.get("/api/v1/devices");
    const { devices } = (await devicesRes.json()) as { devices: { groupId: string | null; hostname: string | null }[] };
    const named = devices.find((device) => device.groupId === tv!.id && device.hostname?.trim());
    expect(named, "The mock seed must name a TV device").toBeTruthy();
    await expect(sheet.getByText(named!.hostname!.trim(), { exact: false })).toBeVisible();
    await expect(sheet.getByText(/Category, app and website rules stay as they are/)).toBeVisible();
    const paused = page.waitForResponse((response) => response.url().endsWith(`/groups/${tv!.id}/rules/internet/pause`));
    await sheet.getByRole("button", { name: /For 30 minutes/ }).click();
    expect((await paused).ok()).toBeTruthy();
    await expect(page.getByRole("heading", { name: "All internet · off" })).toBeVisible();
    await expect(page.getByText(/All internet paused until/).first()).toBeVisible();

    const resumed = page.waitForResponse((response) => response.url().endsWith(`/groups/${tv!.id}/rules/internet/resume`));
    await page.locator('[aria-live="polite"]').getByRole("button", { name: "Undo" }).click();
    expect((await resumed).ok()).toBeTruthy();
    await expect(page.getByRole("button", { name: "Pause all internet" })).toBeVisible();
  } finally {
    // Leave the group as the seed had it, even when a step above failed.
    await page.request.post(`/api/v1/groups/${tv!.id}/rules/internet/resume`, { headers: await csrfHeaders(page) });
    await setEnabled(true);
  }
});

test("Websites rule blocks named domains, with the encrypted DNS caveat", async ({ page }) => {
  await signIn(page);
  const groupsRes = await page.request.get("/api/v1/groups");
  const body = (await groupsRes.json()) as { groups: { id: string; name: string }[] };
  const child = body.groups.find((group) => group.name === (test.info().project.name === "phone" ? "Abby" : "Betsy"));
  const ruleName = `QA sites ${test.info().project.name} ${Date.now() % 100000}`;

  await page.goto(`/rules/new?group=${child!.id}`);
  await page.getByRole("button", { name: "Websites" }).click();
  await expect(page.getByText(/a device using encrypted DNS can get around this/)).toBeVisible();
  await page.getByRole("button", { name: "Always", exact: true }).click();
  await page.getByLabel("Rule name").fill(ruleName);
  await page.getByLabel("Add a website").fill("https://www.Example.com/watch");
  await page.getByLabel("Add a website").press("Enter");
  await expect(page.getByRole("button", { name: "Remove www.example.com" })).toBeVisible();
  const created = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/rules"),
  );
  await page.getByRole("button", { name: "Create rule" }).last().click();
  const res = await created;
  expect(res.ok()).toBeTruthy();
  const { rule } = (await res.json()) as { rule: { id: string; domains: string[]; mode: string } };
  expect([rule.domains, rule.mode]).toEqual([["www.example.com"], "always"]);
  await page.request.delete(`/api/v1/rules/${rule.id}`, { headers: await csrfHeaders(page) });
});

test("cards show every household category; one UniFi cannot block offers a Websites rule", async ({ page }) => {
  await signIn(page);
  const body = (await (await page.request.get("/api/v1/groups")).json()) as { groups: { id: string; name: string; kind: string }[] };
  const kid = body.groups.find((group) => group.kind === "family" && group.name === (test.info().project.name === "phone" ? "Abby" : "Betsy"));
  expect(kid, "The mock seed must include Betsy and Abby").toBeTruthy();

  await page.goto("/family");
  const marks = page.getByTestId(`filter-marks-${kid!.id}`);
  const card = page.locator("article").filter({ has: marks });
  // Not just the five UniFi categories: AI, Dating, Gambling and Adult are there too.
  await marks.getByRole("button", { name: /^Show all \d+ categories$/ }).click();
  for (const name of ["AI", "Dating", "Gambling", "Adult", "Video"]) {
    await expect(marks.getByRole("button", { name: new RegExp(`^${name} `) })).toBeVisible();
  }

  await marks.getByRole("button", { name: /^AI / }).click();
  await card.getByRole("button", { name: "Add rule" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/UniFi has no AI category/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Create policy" })).toHaveCount(0);
  await sheet.getByRole("link", { name: "Block its websites" }).click();
  await expect(page).toHaveURL(/\/rules\/new\?kind=domain/);
  // A named draft titles the page with its name.
  await expect(page.getByRole("heading", { name: `AI for ${kid!.name}`, level: 1 })).toBeVisible();
  await expect(page.getByLabel("Rule name")).toHaveValue(`AI for ${kid!.name}`);
  await expect(page.getByRole("button", { name: "Remove openai.com" })).toBeVisible();

  // Categories and apps are picked like websites: nothing is listed until you search the
  // gateway's catalog, and a rule can block several at once.
  for (const { kind, noun, first, second, ids } of [
    { kind: "category", noun: "categories", first: ["media", /Video/], second: ["alpha", "Fixture Category Alpha"], ids: [4, 9001] },
    { kind: "app", noun: "apps", first: ["one", "Fixture App One"], second: ["suite", "Fixture Productivity Suite"], ids: [] as number[] },
  ] as const) {
    await page.goto(`/rules/new?kind=${kind}&group=${kid!.id}`);
    const matches = page.getByRole("group", { name: `Matching ${noun}` });
    await expect(matches).toHaveCount(0);
    const search = page.getByLabel(`Search ${noun}`);
    for (const [text, name] of [first, second] as const) {
      const searched = page.waitForResponse((response) => response.url().includes(`filter=${text}`));
      await search.fill(text);
      await searched;
      await matches.getByRole("button", { name }).click();
      await expect(search).toHaveValue("");
    }
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(2);
    await page.getByLabel("Rule name").fill(`QA ${noun} ${test.info().project.name} ${Date.now() % 100000}`);
    const created = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/rules"));
    await page.getByRole("button", { name: "Create rule" }).last().click();
    const res = await created;
    expect(res.ok()).toBeTruthy();
    const { rule } = (await res.json()) as { rule: { id: string; targetIds: number[] } };
    try {
      expect(rule.targetIds).toHaveLength(2);
      if (ids.length) expect(rule.targetIds).toEqual(ids);
    } finally {
      await page.request.delete(`/api/v1/rules/${rule.id}`, { headers: await csrfHeaders(page) });
    }
  }
});

test("Phase 4: card marks, filter sheets, soft polish, no upstream claim without a resolver", async ({ page }) => {
  await signIn(page);

  const groupsRes = await page.request.get("/api/v1/groups");
  expect(groupsRes.ok()).toBeTruthy();
  const body = (await groupsRes.json()) as {
    groups: { id: string; name: string; kind: string; familyRole: string | null }[];
  };
  // Prefer distinct seeded kids per project to reduce desktop/phone races (same as Rules shell).
  const preferredName = test.info().project.name === "phone" ? "Abby" : "Betsy";
  const child =
    body.groups.find((group) => group.kind === "family" && group.name === preferredName) ??
    body.groups.find((group) => group.kind === "family" && (group.familyRole === "child" || group.familyRole === "teen"));
  expect(child, "The mock seed must include a family child").toBeTruthy();
  const adult = body.groups.find((group) => group.familyRole === "adult");
  expect(adult).toBeTruthy();

  await page.goto("/family");
  await expect(page.getByRole("heading", { name: "Family" })).toBeVisible();
  const marks = page.getByTestId(`filter-marks-${child!.id}`);
  await expect(marks).toBeVisible();

  // Ensure Video starts Off (turn off a rule a prior run left on).
  const rulesRes = await page.request.get("/api/v1/rules");
  expect(rulesRes.ok()).toBeTruthy();
  const { rules } = (await rulesRes.json()) as {
    rules: { id: string; kind: string; enabled: boolean; groupIds: string[]; targetIds: number[] }[];
  };
  for (const rule of rules) {
    if (rule.kind === "category" && rule.enabled && rule.groupIds.includes(child!.id) && rule.targetIds.includes(4)) {
      const off = await page.request.post(`/api/v1/rules/${rule.id}/off`, { headers: await csrfHeaders(page) });
      expect(off.ok()).toBeTruthy();
    }
  }
  await page.reload();
  // Video is left unmeasured by the mock seed, so with no rule it must read "not
  // blocked" — a mark with no verdict must never imply one. The DNS-derived states are
  // asserted in upstream-marks.spec.
  await expect(marks.getByRole("button", { name: /Video not blocked/i })).toBeVisible();
  await expect(page.getByText(/Porn/i)).toHaveCount(0);
  // No App + on list cards
  await expect(marks.getByRole("button", { name: "Add app filter" })).toHaveCount(0);
  // No group is exempt: an adult's card shows its marks too.
  await expect(page.getByTestId(`filter-marks-${adult!.id}`)).toBeVisible();

  // A mark opens the card on that category. With no rule and nothing measured, the
  // zone and the sheet must not claim anything about DNS either way.
  const card = page.locator("article").filter({ has: marks });
  await marks.getByRole("button", { name: /Video not blocked/i }).click();
  await expect(card.locator("button[aria-expanded=true]")).toBeVisible();
  await expect(card.getByText("· no rule · not checked")).toBeVisible();
  await card.getByRole("button", { name: "Add rule" }).click();
  const offSheet = page.getByRole("dialog");
  await expect(offSheet.getByRole("heading", { name: /Nothing's blocking Video yet/i })).toBeVisible();
  await expect(offSheet.getByText(/DNS/i)).toHaveCount(0);
  // Off may POST create (no rule) or PATCH enable (existing disabled rule).
  const create = page.waitForResponse((response) => {
    const method = response.request().method();
    const url = response.url();
    return (
      (method === "POST" && url.includes("/api/v1/rules") && !url.includes("/off")) ||
      (method === "PATCH" && /\/api\/v1\/rules\/[^/]+$/.test(url))
    );
  });
  await offSheet.getByRole("button", { name: "Create policy" }).click();
  expect((await create).ok()).toBeTruthy();

  // The focused zone now shows the rule, with a way to edit it.
  await expect(card.getByRole("heading", { name: "Video · blocked" })).toBeVisible();
  await expect(card.getByRole("link", { name: "Edit rule" })).toBeVisible();

  // On the group's page, the mark opens the sheet: On → Turn off
  await page.goto(`/family/${child!.id}`);
  const detailMarks = page.getByTestId(`filter-marks-${child!.id}`);
  await detailMarks.getByRole("button", { name: /Video blocked by FamilyFi/i }).click();
  const onSheet = page.getByRole("dialog");
  await expect(onSheet.getByRole("heading", { name: /Video · blocked/i })).toBeVisible();
  await expect(onSheet.getByRole("button", { name: "Turn off" })).toBeVisible();
  const off = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/api\/v1\/rules\/[^/]+\/off/.test(response.url()),
  );
  await onSheet.getByRole("button", { name: "Turn off" }).click();
  expect((await off).ok()).toBeTruthy();
  await expect(detailMarks.getByRole("button", { name: /Video not blocked/i })).toBeVisible();

  // GroupDetail: App + present
  await expect(page.getByRole("button", { name: "Add app filter" })).toBeVisible();
  // No Category +
  await expect(page.getByRole("button", { name: "Add category filter" })).toHaveCount(0);

  // The rule editor names categories, never raw DPI ids.
  // Searching by the familiar name finds it, though the gateway calls it "Media streaming".
  await page.goto("/rules/new?kind=category");
  await page.getByLabel("Search categories").fill("video");
  const curated = page.getByRole("group", { name: "Matching categories" });
  await expect(curated.getByRole("button", { name: /Video/i })).toBeVisible();
  await expect(curated.getByText(/\(\s*4\s*\)/)).toHaveCount(0);
  await expect(page.getByText(/permanent block/i)).toHaveCount(0);

  // Network scope needs managed networks (desktop only — avoids settings races).
  if (test.info().project.name === "desktop") {
    const unifiGet = await page.request.get("/api/v1/settings/unifi");
    expect(unifiGet.ok()).toBeTruthy();
    const prev = (await unifiGet.json()) as {
      unifi: { manageAllNetworks: boolean; managedNetworkIds: string[] };
    };
    try {
      const headers = await csrfHeaders(page);
      const put = await page.request.put("/api/v1/settings/unifi", {
        headers,
        data: { manageAllNetworks: false, managedNetworkIds: [] },
      });
      expect(put.ok()).toBeTruthy();
      // With no managed networks, a rule can only cover people and things.
      await page.goto("/rules/new?kind=category");
      await expect(page.getByRole("button", { name: "Whole networks" })).toHaveCount(0);
    } finally {
      await page.request.put("/api/v1/settings/unifi", {
        headers: await csrfHeaders(page),
        data: {
          manageAllNetworks: prev.unifi.manageAllNetworks,
          managedNetworkIds: prev.unifi.managedNetworkIds,
        },
      });
    }
  }
});
