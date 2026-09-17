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

async function firstChild(page: Page) {
  const body = (await (await page.request.get("/api/v1/groups")).json()) as {
    groups: { id: string; name: string; kind: string; protected: boolean }[];
  };
  const kid = body.groups.find((group) => group.kind === "family" && !group.protected);
  expect(kid, "seed must include a non-protected family group").toBeTruthy();
  return kid!;
}

test("a group can take its own resolver and hand it back", async ({ page }) => {
  await signIn(page);
  const kid = await firstChild(page);
  await page.goto(`/family/${kid.id}`);

  const card = page.locator("section", { has: page.getByRole("heading", { name: "DNS-over-HTTPS" }) });
  await expect(card).toBeVisible();

  // Leave it as found: clear any override before asserting the default state.
  if (await card.getByRole("button", { name: "Remove override" }).count()) {
    await card.getByRole("button", { name: "Remove override" }).click();
  }
  await expect(card.getByText(/Uses the household default/i)).toBeVisible();

  await card.getByRole("button", { name: "Override for this member" }).click();
  await page
    .getByLabel(`DNS-over-HTTPS endpoint for ${kid.name}`)
    .fill("https://strict.example.com/dns-query/kids");
  await card.getByRole("button", { name: "Save endpoint" }).click();

  // Shown in full — a mistyped endpoint has to be visible to be fixable.
  await expect(card.getByText("https://strict.example.com/dns-query/kids")).toBeVisible();
  await expect(card.getByRole("button", { name: "Replace" })).toBeVisible();

  await card.getByRole("button", { name: "Remove override" }).click();
  await expect(card.getByText(/Uses the household default/i)).toBeVisible();
});

test("a bad endpoint is refused with a reason", async ({ page }) => {
  await signIn(page);
  const kid = await firstChild(page);
  await page.goto(`/family/${kid.id}`);

  const card = page.locator("section", { has: page.getByRole("heading", { name: "DNS-over-HTTPS" }) });
  if (await card.getByRole("button", { name: "Remove override" }).count()) {
    await card.getByRole("button", { name: "Remove override" }).click();
  }
  await card.getByRole("button", { name: "Override for this member" }).click();
  await page.getByLabel(`DNS-over-HTTPS endpoint for ${kid.name}`).fill("http://dns.example.com/q");
  await card.getByRole("button", { name: "Save endpoint" }).click();

  await expect(card.getByText(/must start with https/i)).toBeVisible();
});
