import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Every page, in both viewports, against WCAG 2.1 A and AA with axe. AGENTS.md sets the
 * contrast floor at 4.5:1; this is where a rendered page is held to it, with no
 * exceptions. tests/unit/mark-contrast.test.ts checks the colour tokens themselves.
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const password = process.env.FAMILYFI_DEFAULT_PASSWORD;

async function signIn(page: Page) {
  const login = await page.request.post("/api/v1/auth/login", { data: { username: "admin", password, client: "browser" } });
  expect(login.ok()).toBe(true);
}

async function expectAccessible(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
  // Swagger UI on /reference is third-party markup; FamilyFi's own chrome around it is still checked.
  const result = await new AxeBuilder({ page }).withTags(WCAG).exclude(".swagger-ui").analyze();
  const problems: string[] = [];
  for (const violation of result.violations) {
    for (const node of violation.nodes) {
      const contrast = node.any.find((check) => check.id === "color-contrast")?.data as
        | { fgColor?: string; bgColor?: string; contrastRatio?: number }
        | undefined;
      const detail = contrast ? ` ${contrast.fgColor} on ${contrast.bgColor} is ${contrast.contrastRatio}:1` : "";
      problems.push(`${violation.id} (${violation.impact})${detail} at ${node.target.join(" ")}: ${violation.help}`);
    }
  }
  expect(problems, `${route} accessibility`).toEqual([]);
}

test.describe("accessibility", () => {
  test("sign-in page", async ({ page }) => {
    await expectAccessible(page, "/login");
  });

  for (const route of ["/family", "/family/new", "/things", "/things/new", "/devices", "/rules", "/categories", "/phones", "/sync", "/settings", "/reference"]) {
    test(route, async ({ page }) => {
      await signIn(page);
      await expectAccessible(page, route);
    });
  }

  test("detail pages", async ({ page }) => {
    await signIn(page);
    const { groups } = (await (await page.request.get("/api/v1/groups")).json()) as { groups: { id: string; kind: string }[] };
    const { categories } = (await (await page.request.get("/api/v1/upstream/categories")).json()) as { categories: { id: string }[] };
    const family = groups.find((group) => group.kind === "family");
    const things = groups.find((group) => group.kind === "things");
    expect(family && things && categories[0], "the mock household has a person, a things group and a category").toBeTruthy();
    await expectAccessible(page, `/family/${family!.id}`);
    await expectAccessible(page, `/things/${things!.id}`);
    await expectAccessible(page, `/categories/${categories[0].id}`);
  });
});
