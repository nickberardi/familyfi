import { expect, test, type Page } from "@playwright/test";

const password = process.env.FAMILYFI_DEFAULT_PASSWORD;

async function signIn(page: Page) {
  test.skip(!password, "FAMILYFI_DEFAULT_PASSWORD is required for browser tests");
  const login = await page.request.post("/api/v1/auth/login", { data: { username: "admin", password, client: "browser" } });
  expect(login.ok()).toBe(true);
}

test("System → API copies the spec's address and opens the agent prompt", { tag: "@desktop" }, async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await page.goto("/reference");

  await expect(page.getByRole("heading", { name: "FamilyFi API", exact: true })).toBeVisible();
  // Swagger's own title block, with the spec link and license, is hidden; the demo note is the demo's alone.
  await expect(page.getByText("Business Source License 1.1")).toBeHidden();
  await expect(page.getByTestId("api-demo-note")).toHaveCount(0);

  await page.getByRole("button", { name: /OpenAPI spec/ }).click();
  await expect(page.getByRole("button", { name: /Copied/ })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(baseURL!).origin}/openapi`);

  await page.getByRole("button", { name: "Agent instructions" }).click();
  const sheet = page.getByRole("dialog", { name: "Connect an agent" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toHaveCount(0);
});

test("System → API shows the spec's address where nothing can copy", { tag: "@desktop" }, async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined });
    document.execCommand = () => false;
  });
  await signIn(page);
  await page.goto("/reference");
  await page.getByRole("button", { name: /OpenAPI spec/ }).click();
  await expect(page.getByTestId("api-spec-address")).toContainText("/openapi");
});
