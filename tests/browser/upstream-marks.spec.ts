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

/**
 * Removes every category rule this group has for a DPI slot, so a spec starts from a
 * known state. Nothing stops two rules targeting the same slot, and a leftover enabled
 * one would mask the DNS verdict the spec is here to check.
 */
async function clearSlotRules(page: Page, groupId: string, categoryId: number) {
  const body = (await (await page.request.get("/api/v1/rules")).json()) as {
    rules: { id: string; groupId: string | null; kind: string; targetIds: number[] }[];
  };
  const csrf = (await page.context().cookies()).find((c) => c.name === "familyfi_csrf")?.value ?? "";
  for (const rule of body.rules) {
    if (rule.groupId === groupId && rule.kind === "category" && rule.targetIds.includes(categoryId)) {
      await page.request.delete(`/api/v1/rules/${rule.id}`, { headers: { "X-CSRF-Token": csrf } });
    }
  }
}

async function childGroup(page: Page) {
  const body = (await (await page.request.get("/api/v1/groups")).json()) as {
    groups: { id: string; name: string; kind: string; protected: boolean }[];
  };
  const kid = body.groups.find((group) => group.kind === "family" && !group.protected);
  expect(kid, "seed must include a non-protected family group").toBeTruthy();
  return kid!;
}

/**
 * The precedence rule, end to end: a mark shows a FamilyFi policy when one is blocking,
 * and otherwise reports what the group's resolver is doing. The mock household seeds a
 * blocked verdict for Social and a partial one for Gaming, and leaves Video unmeasured.
 */
test("a mark reports DNS when no FamilyFi rule is blocking", async ({ page }) => {
  await signIn(page);
  const kid = await childGroup(page);
  await clearSlotRules(page, kid.id, 24);
  await page.goto(`/family/${kid.id}`);

  const marks = page.getByTestId(`filter-marks-${kid.id}`);
  await expect(marks).toBeVisible();

  await expect(marks.getByRole("button", { name: /Social already blocked by DNS/i })).toBeVisible();
  await expect(marks.getByRole("button", { name: /Gaming partially blocked by DNS/i })).toBeVisible();
  // Unmeasured and unruled stays honest.
  await expect(marks.getByRole("button", { name: /Video not blocked/i })).toBeVisible();
});

test("the sheet explains an upstream block without claiming FamilyFi did it", async ({ page }) => {
  await signIn(page);
  const kid = await childGroup(page);
  await clearSlotRules(page, kid.id, 24);
  await page.goto(`/family/${kid.id}`);

  const marks = page.getByTestId(`filter-marks-${kid.id}`);
  await marks.getByRole("button", { name: /Social already blocked by DNS/i }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: /Already blocked \(DNS\)/i })).toBeVisible();
  // It must say FamilyFi is not the one blocking, since it cannot schedule or pause it.
  await expect(sheet.getByText(/FamilyFi is not doing it/i)).toBeVisible();
  await sheet.getByRole("button", { name: /Never mind|Cancel|Close/i }).first().click();
});

test("a FamilyFi rule outranks the DNS verdict on the same mark", async ({ page }) => {
  await signIn(page);
  const kid = await childGroup(page);
  await clearSlotRules(page, kid.id, 24);
  await page.goto(`/family/${kid.id}`);

  const marks = page.getByTestId(`filter-marks-${kid.id}`);
  await expect(marks.getByRole("button", { name: /Social already blocked by DNS/i })).toBeVisible();

  // Creating our own policy for a category DNS already blocks must flip the mark to
  // ours — an enabled rule is the state shown, whatever the resolver reports.
  await marks.getByRole("button", { name: /Social already blocked by DNS/i }).click();
  const sheet = page.getByRole("dialog");
  const created = page.waitForResponse(
    (response) =>
      ["POST", "PATCH"].includes(response.request().method()) && response.url().includes("/api/v1/rules"),
  );
  await sheet.getByRole("button", { name: /Create|Turn on/i }).first().click();
  expect((await created).ok()).toBeTruthy();

  await expect(marks.getByRole("button", { name: /Social blocked by FamilyFi/i })).toBeVisible();

  // Take our policy away entirely and the mark falls back to the resolver, rather than
  // to "nothing is blocking this".
  await clearSlotRules(page, kid.id, 24);
  await page.reload();
  await expect(marks.getByRole("button", { name: /Social already blocked by DNS/i })).toBeVisible();
});
