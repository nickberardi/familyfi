import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Page } from "./fixtures";

import { answerConfirm } from "./confirm-dialog";

const password = process.env.FAMILYFI_DEFAULT_PASSWORD;
const shots = process.env.ASKS_SCREENSHOT_DIR;

// Remote access publishes one route for the whole household, and Settings' waits are the
// household's, so these run one at a time.
test.describe.configure({ mode: "serial" });

async function signIn(page: Page) {
  test.skip(!password, "FAMILYFI_DEFAULT_PASSWORD is required for browser tests");
  const login = await page.request.post("/api/v1/auth/login", { data: { username: "admin", password, client: "browser" } });
  expect(login.ok()).toBe(true);
}

async function csrf(page: Page): Promise<Record<string, string>> {
  const value = (await page.context().cookies()).find((cookie) => cookie.name === "familyfi_csrf")?.value ?? "";
  return { "x-csrf-token": value, "content-type": "application/json" };
}

/** Screenshots for review, when `ASKS_SCREENSHOT_DIR` names a folder for them. */
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}-${test.info().project.name}.png`, fullPage: true });
}

/**
 * WCAG 2.1 A and AA with axe, as tests/browser/accessibility.spec.ts holds every page; only within
 * `within` when it is given, such as an open sheet.
 */
async function expectAccessible(page: Page, what: string, within?: string) {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  const result = await (within ? builder.include(within) : builder).analyze();
  const problems = result.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id} at ${node.target.join(" ")}: ${violation.help}`));
  expect(problems, `${what} accessibility`).toEqual([]);
}

type Group = { id: string; name: string; kind: string; ask?: unknown };

async function cassie(page: Page): Promise<Group> {
  const { groups } = (await (await page.request.get("/api/v1/groups")).json()) as { groups: Group[] };
  const group = groups.find((item) => item.kind === "family" && item.name === "Cassie");
  expect(group, "the seed household has Cassie").toBeTruthy();
  return group!;
}

/**
 * Cassie's phone asked to be unpaused a few minutes ago. A child's phone can't pair in a browser
 * test, so the household's answer carries the ask as FamilyFi sends it (`Group.ask`).
 */
async function withWaitingAsk(page: Page, group: Group, about: { about: "pause" } | { about: "rule"; ruleId: string; minutes: number } = { about: "pause" }) {
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 55 * 60_000).toISOString();
  const ask = { id: "ask-browser", ...about, state: "waiting", at, expiresAt };
  const declined: string[] = [];
  await page.route(/\/api\/v1\/groups(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as { groups: Group[] };
    const answered = declined.length > 0;
    body.groups = body.groups.map((item) => (item.id === group.id ? { ...item, ask: answered ? { ...ask, state: "no", answeredAt: new Date().toISOString() } : ask } : item));
    await route.fulfill({ response, json: body });
  });
  await page.route(`**/api/v1/groups/${group.id}/asks/${ask.id}/decline`, async (route) => {
    declined.push(route.request().method());
    // The decline's answer is the group with its ask closed, as FamilyFi sends it.
    await route.fulfill({ json: { group: { ...group, ask: { ...ask, state: "no", answeredAt: new Date().toISOString() } } } });
  });
  return declined;
}

test("a child's ask shows on their card and page, and Not now answers it", async ({ page }) => {
  await signIn(page);
  const group = await cassie(page);
  const declined = await withWaitingAsk(page, group);

  await page.goto("/family");
  const line = page.getByTestId(`group-ask-${group.id}`);
  await expect(line).toHaveText("Asked to be unpaused");
  await shot(page, "family-ask-line");
  await expectAccessible(page, "the family card with an ask");

  await page.goto(`/family/${group.id}`);
  await page.getByTestId(`group-ask-${group.id}`).click();
  const sheet = page.getByRole("dialog", { name: "Cassie asked to be unpaused" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(/Asked at \d{1,2}:\d\d [AP]M\. It closes at \d{1,2}:\d\d [AP]M if no one answers\./);
  await expect(sheet.getByRole("button", { name: /^Unpause/ })).toBeVisible();
  await shot(page, "ask-sheet");
  await expectAccessible(page, "the answer sheet", "[role=dialog]");

  await sheet.getByRole("button", { name: /^Not now/ }).click();
  await expect(sheet).toHaveCount(0);
  expect(declined).toEqual(["POST"]);
  await expect(page.getByTestId(`group-ask-${group.id}`)).toHaveCount(0);
});

test("Settings sets how long an ask waits and how soon a child can ask again", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  const before = (await (await page.request.get("/api/v1/settings/household")).json()) as { household: { askTimeoutMinutes: number; askWaitMinutes: number } };
  try {
    await page.goto("/settings");
    const card = page.getByTestId("settings-asks");
    await expect(card).toContainText("Asking for more time");
    await card.getByLabel("An ask waits for an answer").selectOption("120");
    await expect.poll(async () => ((await (await page.request.get("/api/v1/settings/household")).json()) as typeof before).household.askTimeoutMinutes).toBe(120);
    await card.getByLabel("After Not now, they can ask again").selectOption("0");
    await expect.poll(async () => ((await (await page.request.get("/api/v1/settings/household")).json()) as typeof before).household.askWaitMinutes).toBe(0);
    await shot(page, "settings-asks");
  } finally {
    await page.request.put("/api/v1/settings/household", {
      headers: await csrf(page),
      data: { askTimeoutMinutes: before.household.askTimeoutMinutes, askWaitMinutes: before.household.askWaitMinutes },
    });
  }
});

test("pairs FamilyFi Me for a family member from their page", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  const group = await cassie(page);
  const headers = await csrf(page);
  const url = `https://me-${Date.now()}.tail1234.ts.net`;
  const route = ((await (await page.request.post("/api/v1/connection/endpoints", { headers, data: { url, transport: "tailscale", trustMode: "system", priority: 0 } })).json()) as { endpoint: { id: string } }).endpoint.id;
  try {
    // With no route published there is nothing to pair through, and the card says how to get one.
    await page.goto(`/family/${group.id}`);
    const card = page.getByTestId("child-phones");
    await expect(card).toContainText("Turn on remote access under Pair Device, then pair FamilyFi Me.");
    await expect(card.getByRole("button", { name: "Pair FamilyFi Me" })).toBeDisabled();

    await page.request.put("/api/v1/connection/tunnel", { headers, data: { mode: "named", endpointId: route } });
    await page.reload();
    await expect(card).toContainText("Pair FamilyFi Me on Cassie's phone so they can see their rules and ask you for more time.");
    await shot(page, "child-phones-empty");
    await card.getByRole("button", { name: "Pair FamilyFi Me" }).click();
    const sheet = page.getByRole("dialog", { name: "Pair FamilyFi Me" });
    await expect(sheet.getByLabel("For")).toHaveValue(group.id);
    await expect(sheet.getByLabel("Phone name")).toHaveValue("Cassie's phone");
    await shot(page, "pair-me-sheet");
    // The invite is for Cassie's group, never an account.
    const invited = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/v1/paired/invites"));
    await sheet.getByRole("button", { name: "Show pairing code" }).click();
    expect((await invited).postDataJSON()).toEqual({ clientType: "me", endpointId: route, displayName: "Cassie's phone", groupId: group.id });
    const code = page.getByRole("dialog", { name: "Scan with FamilyFi Me" });
    await expect(code.getByTestId("pairing-code")).not.toBeEmpty();
    await shot(page, "pair-me-code");
    await code.getByRole("button", { name: "Cancel" }).click();
  } finally {
    await page.request.put("/api/v1/connection/tunnel", { headers, data: { mode: "off" } });
    await page.request.delete(`/api/v1/connection/endpoints/${route}`, { headers });
  }
});

test("a child's ask for time off a rule offers what they asked, the window's end, a time of your own and Not now", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  const group = await cassie(page);
  const headers = await csrf(page);
  // A window that is on whenever the test runs.
  const created = await page.request.post("/api/v1/rules", {
    headers,
    data: { name: "Browser bedtime", kind: "internet", groupIds: [group.id], mode: "scheduled", windows: [{ name: "", days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" }] },
  });
  expect(created.status()).toBe(201);
  const ruleId = ((await created.json()) as { rule: { id: string } }).rule.id;
  try {
    await withWaitingAsk(page, group, { about: "rule", ruleId, minutes: 30 });
    await page.goto(`/family/${group.id}`);
    await expect(page.getByTestId(`group-ask-${group.id}`)).toHaveText("Asked for 30 minutes off Browser bedtime");
    await page.getByTestId(`group-ask-${group.id}`).click();
    const sheet = page.getByRole("dialog", { name: "Cassie asked for 30 minutes off Browser bedtime" });
    await expect(sheet.getByRole("button", { name: /^Allow 30 minutes/ })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /^Until Browser bedtime ends/ })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /^Not now/ })).toBeVisible();
    await shot(page, "rule-ask-sheet");
    await sheet.getByRole("button", { name: /^For…/ }).click();
    await expect(sheet.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
    await shot(page, "rule-ask-sheet-for");
    await sheet.getByRole("button", { name: "Cancel" }).click();

    // Allow as asked is the rule's own allow with the ask's id. The ask here is the test's, so the
    // server gets the same allow for 30 minutes without it.
    const allowed: unknown[] = [];
    await page.route(`**/api/v1/groups/${group.id}/rules/${ruleId}/allow`, async (route) => {
      allowed.push(route.request().postDataJSON());
      await route.continue({ postData: JSON.stringify({ until: new Date(Date.now() + 30 * 60_000).toISOString() }) });
    });
    await page.getByTestId(`group-ask-${group.id}`).click();
    await page.getByRole("dialog", { name: "Cassie asked for 30 minutes off Browser bedtime" }).getByRole("button", { name: /^Allow 30 minutes/ }).click();
    await expect.poll(() => allowed).toEqual([{ askId: "ask-browser" }]);
    await expect(page.getByText(/^Browser bedtime is off for Cassie until/).filter({ visible: true })).toBeVisible();
  } finally {
    await page.request.delete(`/api/v1/rules/${ruleId}`, { headers });
  }
});

test("a family member's FamilyFi Me phone is listed on their page and can be revoked", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  const group = await cassie(page);
  const phone = {
    id: "me-browser",
    displayName: "Cassie's phone",
    clientType: "me",
    scope: "me:askOnly",
    actsAs: null,
    group: { id: group.id, name: group.name },
    parentDeviceId: null,
    enrolledAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    lastSeenAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    revokedAt: null,
    pairedVia: null,
    edgeTokens: [],
    sessions: [{ id: "s1", username: "device:me-browser", expiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString(), createdAt: new Date().toISOString() }],
  };
  // A child's phone can't pair in a browser test, so the list carries one as FamilyFi sends it.
  const revoked: string[] = [];
  await page.route(/\/api\/v1\/paired\/devices(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as { devices: unknown[] };
    await route.fulfill({ response, json: { devices: revoked.length ? body.devices : [phone, ...body.devices] } });
  });
  let refuse = true;
  await page.route(`**/api/v1/paired/devices/${phone.id}`, async (route) => {
    // The first revoke fails, and its message stays after the list reloads.
    if (refuse) {
      refuse = false;
      return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "That phone couldn't be revoked." } } });
    }
    revoked.push(route.request().method());
    await route.fulfill({ json: {} });
  });
  await page.goto(`/family/${group.id}`);
  const card = page.getByTestId("child-phones");
  await expect(card).toContainText("Cassie's phone");
  await expect(card).toContainText("Asks only");
  await expect(card).toContainText("For Cassie");
  // With remote access off, the card says why Pair FamilyFi Me is off, phones listed or not.
  await expect(card.getByRole("button", { name: "Pair FamilyFi Me" })).toBeDisabled();
  await expect(card).toContainText("Turn on remote access");
  await card.scrollIntoViewIfNeeded();
  await shot(page, "child-phones-listed");
  await expectAccessible(page, "a family member's FamilyFi Me phones");
  await card.getByRole("button", { name: "Revoke" }).click();
  const reloaded = page.waitForResponse((response) => /\/api\/v1\/paired\/devices(\?.*)?$/.test(response.url()) && response.request().method() === "GET");
  await answerConfirm(page);
  await reloaded;
  await expect(page.getByRole("alert").filter({ hasText: "That phone couldn't be revoked." })).toBeVisible();
  await card.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await shot(page, "child-phone-revoke");
  expect(await answerConfirm(page)).toBe("Revoke Cassie's phone? FamilyFi Me on it signs out now and stops showing Cassie's rules or asking for more time until it is paired again.");
  expect(revoked).toEqual(["DELETE"]);
  await expect(card).not.toContainText("Cassie's phone");
});

test("Pair Device, the pairing sheet and Settings fit a phone", { tag: "@phone" }, async ({ page }) => {
  await signIn(page);
  const headers = await csrf(page);
  const url = `https://me-phone-${Date.now()}.tail1234.ts.net`;
  const route = ((await (await page.request.post("/api/v1/connection/endpoints", { headers, data: { url, transport: "tailscale", trustMode: "system", priority: 0 } })).json()) as { endpoint: { id: string } }).endpoint.id;
  await page.request.put("/api/v1/connection/tunnel", { headers, data: { mode: "named", endpointId: route } });
  try {
    await page.goto("/pair");
    await expect(page.getByTestId("pair-me")).toBeEnabled();
    await shot(page, "pair-page");
    await page.getByTestId("pair-me").click();
    const sheet = page.getByRole("dialog", { name: "Pair FamilyFi Me" });
    // Children first: the phone is most likely for one of them.
    await expect(sheet.getByLabel("Phone name")).toHaveValue("Cassie's phone");
    await shot(page, "pair-me-sheet");
    await expectAccessible(page, "the Pair FamilyFi Me sheet", "[role=dialog]");
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await page.goto("/settings");
    await page.getByTestId("settings-asks").scrollIntoViewIfNeeded();
    await shot(page, "settings-asks");
    await expectAccessible(page, "Settings with asking for more time");
  } finally {
    await page.request.put("/api/v1/connection/tunnel", { headers, data: { mode: "off" } });
    await page.request.delete(`/api/v1/connection/endpoints/${route}`, { headers });
  }
});
