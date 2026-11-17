import { expect, test, type Page } from "./fixtures";

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
async function withWaitingAsk(page: Page, group: Group) {
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 55 * 60_000).toISOString();
  const ask = { id: "ask-browser", about: "pause", state: "waiting", at, expiresAt };
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

  await page.goto(`/family/${group.id}`);
  await page.getByTestId(`group-ask-${group.id}`).click();
  const sheet = page.getByRole("dialog", { name: "Cassie asked to be unpaused" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(/Asked at \d{1,2}:\d\d [AP]M\. It closes at \d{1,2}:\d\d [AP]M if no one answers\./);
  await expect(sheet.getByRole("button", { name: /^Unpause/ })).toBeVisible();
  await shot(page, "ask-sheet");

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
