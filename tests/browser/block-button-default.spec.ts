import { expect, test, type Page } from "./fixtures";

const username = process.env.FAMILYFI_RECOVERY_USERNAME ?? "admin";
const password = process.env.FAMILYFI_DEFAULT_PASSWORD;

async function signIn(page: Page) {
  test.skip(!password, "FAMILYFI_DEFAULT_PASSWORD is required for browser tests");
  const login = await page.request.post("/api/v1/auth/login", {
    data: { username, password, client: "browser" },
  });
  if (!login.ok()) throw new Error(`login failed (${login.status()})`);
}

async function csrf(page: Page): Promise<Record<string, string>> {
  const value = (await page.context().cookies()).find((cookie) => cookie.name === "familyfi_csrf")?.value ?? "";
  return { "x-csrf-token": value, "content-type": "application/json" };
}

test("a group's Block button default is saved and names the card's button for that rule", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  const groups = (await (await page.request.get("/api/v1/groups")).json()) as { groups: { id: string; name: string; kind: string }[] };
  const tv = groups.groups.find((group) => group.kind === "things" && group.name === "TV");
  expect(tv, "seed must include the TV group").toBeTruthy();
  // A rule of this test's own, always on, so the button reads "Unblock …" at once.
  const created = await page.request.post("/api/v1/rules", {
    headers: await csrf(page),
    data: { name: "Browser TV shows", kind: "category", groupIds: [tv!.id], targetIds: [4], mode: "always" },
  });
  expect(created.status()).toBe(201);
  const ruleId = ((await created.json()) as { rule: { id: string } }).rule.id;

  try {
    await page.goto(`/things/${tv!.id}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: `Edit ${tv!.name}` });
    const picker = sheet.getByLabel("Block button default");
    await expect(picker).toHaveValue("");
    await expect(picker).toHaveAccessibleDescription(/The Block button on TV’s card blocks and unblocks this/);
    await picker.selectOption(ruleId);
    const label = (await picker.locator(`option[value="${ruleId}"]`).textContent())!;
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toHaveCount(0);

    await expect(page.getByRole("button", { name: `Unblock ${label}`, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("dialog", { name: `Edit ${tv!.name}` }).getByLabel("Block button default")).toHaveValue(ruleId);
  } finally {
    // Deleting the rule puts TV's button back on all internet, as the seed had it.
    await page.request.delete(`/api/v1/rules/${ruleId}`, { headers: await csrf(page) });
  }
});
