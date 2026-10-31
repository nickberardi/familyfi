import { expect, test, type Page } from "@playwright/test";
import { ensureMockUpstreamChecks } from "@/server/dev-seed";

const username = process.env.FAMILYFI_RECOVERY_USERNAME ?? "admin";
const password = process.env.FAMILYFI_DEFAULT_PASSWORD;

// The override test invalidates this group's measurements. Restore the mock's
// reporting fixture for later browser specs, which share this test database.
test.afterEach(async () => { await ensureMockUpstreamChecks(); });

async function signIn(page: Page) {
  test.skip(!password, "FAMILYFI_DEFAULT_PASSWORD is required for browser tests");
  const login = await page.request.post("/api/v1/auth/login", {
    data: { username, password, client: "browser" },
  });
  if (!login.ok()) throw new Error(`login failed (${login.status()})`);
}

async function firstChild(page: Page) {
  const body = (await (await page.request.get("/api/v1/groups")).json()) as {
    groups: { id: string; name: string; kind: string; familyRole: string | null }[];
  };
  const kid = body.groups.find((group) => group.kind === "family" && group.familyRole !== "adult");
  expect(kid, "seed must include a child or teen").toBeTruthy();
  return kid!;
}

/** Opens the group's Edit sheet and returns it to the household resolver if it had its own. */
async function openFresh(page: Page, name: string) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: `Edit ${name}` });
  await expect(sheet).toBeVisible();
  const dns = sheet.getByRole("group", { name: "DNS-over-HTTPS" });
  if ((await dns.getByRole("button", { name: "Own endpoint" }).getAttribute("aria-pressed")) === "true") {
    await dns.getByRole("button", { name: "Household default" }).click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toHaveCount(0);
    return openFresh(page, name);
  }
  return sheet;
}

test("a group can take its own resolver and hand it back", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  const kid = await firstChild(page);
  await page.goto(`/family/${kid.id}`);

  let sheet = await openFresh(page, kid.name);
  await expect(sheet.getByTestId("group-edit-dns-help")).toContainText(/Uses the household's DNS-over-HTTPS override/i);
  await sheet.getByRole("button", { name: "Own endpoint" }).click();
  await sheet.getByLabel("Endpoint URL").fill("https://strict.example.com/dns-query/kids");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);

  // Shown in full — a mistyped endpoint has to be visible to be fixable.
  sheet = await (async () => {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    return page.getByRole("dialog", { name: `Edit ${kid.name}` });
  })();
  await expect(sheet.getByLabel("Endpoint URL")).toHaveValue("https://strict.example.com/dns-query/kids");
  await expect(sheet.getByTestId("group-edit-dns-help")).toContainText(`DNS-over-HTTPS override for ${kid.name}`);

  await sheet.getByRole("button", { name: "Household default" }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);
  sheet = await openFresh(page, kid.name);
  await expect(sheet.getByLabel("Endpoint URL")).toHaveCount(0);
  await expect(sheet.getByTestId("group-edit-dns-help")).toContainText(/Uses the household's DNS-over-HTTPS override/i);
});

test("a missing or bad endpoint is refused with a reason", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  const kid = await firstChild(page);
  await page.goto(`/family/${kid.id}`);

  const sheet = await openFresh(page, kid.name);
  await sheet.getByRole("button", { name: "Own endpoint" }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Paste an https:// endpoint, or use the household default.");
  await sheet.getByLabel("Endpoint URL").fill("http://dns.example.com/q");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("The endpoint must start with https://");
});
