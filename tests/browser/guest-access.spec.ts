import { expect, test } from "@playwright/test";

const password = process.env.FAMILYFI_DEFAULT_PASSWORD;

test("guest pass and voucher controls work at desktop and phone widths", async ({ page }) => {
  test.skip(!password, "FAMILYFI_DEFAULT_PASSWORD is required for browser tests");
  const login = await page.request.post("/api/v1/auth/login", {
    data: { username: "admin", password, client: "browser" },
  });
  expect(login.ok()).toBe(true);

  const snapshot = {
    status: "ready", reason: null, voucherAvailable: true,
    clients: [{ id: "visitor", name: "Visitor iPad", mac: "02:00:00:00:00:46", networkId: "guest-network", authorized: false }],
    passes: [] as { id: string; clientId: string; mac: string; networkId: string; status: string; expiresAt: string }[],
    vouchers: [] as { id: string; code: string; timeLimitMinutes: number; status: string; expiresAt: string | null }[],
  };
  let listingUnavailable = false;
  await page.route("**/api/v1/guests", (route) => listingUnavailable
    ? route.fulfill({ status: 503, json: { error: "unifi_unavailable", message: "UniFi is unavailable." } })
    : route.fulfill({ json: snapshot }));
  await page.route("**/api/v1/guest-passes", async (route) => {
    const body = route.request().postDataJSON() as { clientId: string; timeLimitMinutes: number };
    expect(body).toEqual({ clientId: "visitor", timeLimitMinutes: 120 });
    snapshot.clients[0]!.authorized = true;
    snapshot.passes.push({ id: "pass-1", clientId: "visitor", mac: snapshot.clients[0]!.mac, networkId: "guest-network", status: "active", expiresAt: "2026-09-27T18:00:00.000Z" });
    await route.fulfill({ status: 201, json: { pass: snapshot.passes[0] } });
  });
  await page.route("**/api/v1/guest-vouchers", async (route) => {
    const body = route.request().postDataJSON() as { timeLimitMinutes: number };
    expect(body.timeLimitMinutes).toBe(120);
    snapshot.vouchers.push({ id: "voucher-1", code: "1234567890", timeLimitMinutes: 120, status: "unused", expiresAt: null });
    listingUnavailable = true;
    await route.fulfill({ status: 201, json: { voucher: snapshot.vouchers[0] } });
  });

  await page.goto("/devices");
  const card = page.getByRole("region", { name: "Guest access" });
  await expect(card.getByText("Visitor iPad")).toBeVisible();
  await card.getByRole("button", { name: "Give access" }).click();
  await expect(page.getByRole("dialog", { name: "Guest access for Visitor iPad" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Give access" }).click();
  await expect(card.getByText(/Access until/)).toBeVisible();
  await card.getByRole("button", { name: "Create voucher" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create code" }).click();
  await expect(card.getByText("1234567890")).toBeVisible();
  await expect(card.getByText("Voucher status unknown")).toBeVisible();
  await expect(card.getByText("Access status unknown — check UniFi")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("guest section explains empty setup and managed overlap", async ({ page }) => {
  test.skip(!password, "FAMILYFI_DEFAULT_PASSWORD is required for browser tests");
  const login = await page.request.post("/api/v1/auth/login", {
    data: { username: "admin", password, client: "browser" },
  });
  expect(login.ok()).toBe(true);
  const snapshot = { status: "ready", reason: "no_guest_network", voucherAvailable: false, clients: [], passes: [], vouchers: [] as { id: string; code: string; timeLimitMinutes: number; status: string; expiresAt: string | null }[] };
  await page.route("**/api/v1/guests", (route) => route.fulfill({ json: snapshot }));
  await page.goto("/devices");
  const card = page.getByRole("region", { name: "Guest access" });
  await expect(card.getByText(/Set up a separate guest or hotspot network/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Create voucher" })).toBeDisabled();
  snapshot.reason = "managed_overlap";
  snapshot.vouchers.push({ id: "owned-voucher", code: "1234567890", timeLimitMinutes: 60, status: "unused", expiresAt: null });
  await page.reload();
  await expect(card.getByText(/Exclude the guest network/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Revoke" })).toBeVisible();
});
