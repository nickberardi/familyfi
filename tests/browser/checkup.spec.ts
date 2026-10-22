import { expect, test, type Page } from "@playwright/test";

const username = process.env.FAMILYFI_RECOVERY_USERNAME ?? "admin";
const password = process.env.FAMILYFI_DEFAULT_PASSWORD;

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

test("Checkup shows recommended protection, and the mock household's problems apart from its notes", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  await page.goto("/checkup");

  await expect(page.getByRole("heading", { name: "Checkup", exact: true })).toBeVisible();
  const protection = page.getByTestId("checkup-protection");
  await expect(protection.getByTestId("checkup-protection-quarantine")).toBeVisible();
  await expect(protection.getByTestId("checkup-protection-dns")).toContainText("Lock DNS");
  await expect(protection.getByTestId("checkup-protection-dns").getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/rules/dns");
  const countries = protection.getByTestId("checkup-protection-countries");
  await expect(countries).toContainText("North Korea, Iran, China and 3 more");
  await expect(countries.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/rules/countries");

  // Check now reads the mock gateway; its friendly household has Sonos wired and on Wi-Fi.
  await page.getByTestId("checkup-run").click();
  const network = page.getByTestId("checkup-network");
  await expect(network.getByText("Sonos is both wired and on Wi-Fi")).toBeVisible();
  await expect(network.getByText(/devices? uses? a private Wi-Fi address/)).toBeVisible();
  // A note is never presented as a problem: it is under its own heading and offers "This is intended".
  await expect(network.getByText(/notes · may be on purpose/i)).toBeVisible();
  // Problems count on the nav badge; a note never does, and marking one intended leaves the count alone.
  const badge = page.getByRole("link", { name: /^Checkup/ }).first();
  const before = await badge.textContent();
  const dnsNote = network.locator('[data-testid^="checkup-finding-dns_override:"]');
  await dnsNote.getByRole("button", { name: "This is intended" }).click();
  await expect(network.getByTestId("checkup-dismissed")).toBeVisible();
  await expect(dnsNote).toHaveCount(0);
  await expect(badge).toHaveText(before ?? "");
});

test("the Block countries page edits its draft without saving until asked", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  await page.goto("/rules/countries");

  await expect(page.getByRole("heading", { name: "Block countries", exact: true })).toBeVisible();
  await expect(page.getByTestId("countries-picked-KP")).toBeVisible();
  await page.getByPlaceholder("Search countries").fill("Belarus");
  await page.getByTestId("countries-add-BY").click();
  await expect(page.getByTestId("countries-picked-BY")).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  await page.getByTestId("countries-recommended").click();
  await expect(page.getByTestId("countries-picked-BY")).toHaveCount(0);
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
});

test("Devices points out private Wi-Fi addresses and shows only them on request", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  await page.goto("/devices");

  const notice = page.getByTestId("private-address-notice");
  await expect(notice).toContainText("use a private Wi-Fi address");
  await page.getByTestId("private-address-show").click();
  await expect(page.getByText("Galaxy S24")).toBeVisible();
  await expect(page.getByText("Living Room Apple TV")).toHaveCount(0);
  await expect(page.getByTestId("private-address-mark").first()).toBeVisible();

  await page.getByText("Galaxy S24").click();
  await expect(page.getByTestId("private-address-card")).toContainText("Private Wi-Fi address");
});
