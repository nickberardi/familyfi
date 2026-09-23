import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const password = process.env.FAMILYFI_DEFAULT_PASSWORD;
const shots = process.env.PHONES_SCREENSHOT_DIR;

async function signIn(page: Page) {
  test.skip(!password, "FAMILYFI_DEFAULT_PASSWORD is required for browser tests");
  const login = await page.request.post("/api/v1/auth/login", { data: { username: "admin", password, client: "browser" } });
  expect(login.ok()).toBe(true);
}

async function csrf(page: Page): Promise<Record<string, string>> {
  const value = (await page.context().cookies()).find((cookie) => cookie.name === "familyfi_csrf")?.value ?? "";
  return { "x-csrf-token": value, "content-type": "application/json" };
}

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-${name}.png`, fullPage: true });
}

test("adds a route, pairs a phone from the QR sheet, and revokes it", async ({ page }) => {
  await signIn(page);
  const url = `https://phones-e2e-${test.info().project.name}-${Date.now()}.home`;
  page.on("dialog", (dialog) => void dialog.accept());

  try {
    await page.goto("/phones");
    await expect(page.getByRole("heading", { name: "Phones" })).toBeVisible();

    await page.getByRole("button", { name: "Add route" }).click();
    const routeSheet = page.getByRole("dialog", { name: "Add a route" });
    await routeSheet.getByLabel("Address").fill(url);
    await shot(page, "route-sheet");
    await routeSheet.getByRole("button", { name: "Add route" }).click();
    await expect(page.getByTestId("route-row").filter({ hasText: url })).toBeVisible();

    await page.getByRole("button", { name: "Pair a phone" }).click();
    const pairSheet = page.getByRole("dialog", { name: "Pair a phone" });
    const routeSelect = pairSheet.getByLabel("Route");
    await routeSelect.selectOption({ label: `${url} · Home network` });
    await pairSheet.getByRole("button", { name: "Show pairing code" }).click();

    const qrSheet = page.getByRole("dialog", { name: "Scan with the FamilyFi app" });
    await expect(qrSheet.getByRole("img", { name: "Pairing QR code" })).toBeVisible();
    await expect(qrSheet.getByTestId("pairing-address")).toHaveText(url);
    await expect(qrSheet.getByTestId("pairing-countdown")).toContainText(/Expires in [45]:\d\d/);
    await shot(page, "qr-sheet");

    const code = (await qrSheet.getByTestId("pairing-code").textContent()) ?? "";
    const dot = code.indexOf(".");
    const pairingId = code.slice(0, dot);
    const claim = await page.request.post(`/api/v1/connection/pairings/${pairingId}/claim`, {
      data: { token: code.slice(dot + 1), deviceName: "Playwright iPhone" },
    });
    expect(claim.ok()).toBe(true);
    const claimed = (await claim.json()) as { device: { id: string }; deviceCredential: string };

    await expect(page.getByTestId("pairing-claimed")).toContainText("Paired Playwright iPhone", { timeout: 10_000 });
    await shot(page, "paired");

    const native = await page.request.post("/api/v1/auth/login", {
      data: { username: "admin", password, client: "native", deviceId: claimed.device.id, deviceCredential: claimed.deviceCredential },
    });
    const { token } = (await native.json()) as { token: string };
    const bearer = { authorization: `Bearer ${token}` };
    expect((await page.request.get("/api/v1/connection", { headers: bearer })).status()).toBe(200);

    await page.getByRole("dialog", { name: "Phone paired" }).getByRole("button", { name: "Done" }).click();
    const row = page.getByTestId("phone-row").filter({ hasText: "Playwright iPhone" }).filter({ hasText: url });
    await expect(row).toBeVisible();
    await shot(page, "phones-list");
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toHaveCount(0);

    // A revoked phone's bearer session is gone: its next request is rejected and it must pair again.
    await page.context().clearCookies();
    expect((await page.request.get("/api/v1/connection", { headers: bearer })).status()).toBe(401);
  } finally {
    await signIn(page);
    const headers = await csrf(page);
    const list = (await (await page.request.get("/api/v1/connection/endpoints")).json()) as { endpoints: { id: string; url: string }[] };
    for (const endpoint of list.endpoints.filter((item) => item.url === url)) {
      await page.request.delete(`/api/v1/connection/endpoints/${endpoint.id}`, { headers });
    }
  }
});

test("pins a home-network route from a pasted certificate and hands out the full payload", async ({ page }) => {
  await signIn(page);
  const url = `https://pinned-e2e-${test.info().project.name}-${Date.now()}.home`;
  const dir = mkdtempSync(path.join(tmpdir(), "familyfi-pin-e2e-"));
  page.on("dialog", (dialog) => void dialog.accept());
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2", "-subj", "/CN=familyfi.home", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem")], { stdio: "ignore" });
    const certificate = readFileSync(path.join(dir, "c.pem"), "utf8");

    await page.goto("/phones");
    await page.getByRole("button", { name: "Add route" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a route" });
    await sheet.getByLabel("Address").fill(url);
    await sheet.getByRole("button", { name: "Pin this certificate" }).click();
    await sheet.getByRole("button", { name: "Paste certificate instead" }).click();
    await sheet.getByLabel("Certificate (PEM)").fill(certificate);
    await sheet.getByRole("button", { name: "Use this certificate" }).click();
    await expect(sheet.getByTestId("certificate-read")).toContainText("CN=familyfi.home");
    await expect(sheet.getByLabel("SPKI SHA-256 pin")).toHaveValue(/^[A-Za-z0-9_-]{43}$/);
    await shot(page, "pinned-sheet");
    await sheet.getByRole("button", { name: "Add route" }).click();

    const row = page.getByTestId("route-row").filter({ hasText: url });
    await expect(row).toContainText("Pinned");
    // Nothing answers at this made-up address: the check must say it could not look, never "matches".
    await row.getByRole("button", { name: "Check" }).click();
    await expect(row.getByTestId("pin-check")).toContainText("Couldn't check", { timeout: 10_000 });

    await page.getByRole("button", { name: "Pair a phone" }).click();
    const pair = page.getByRole("dialog", { name: "Pair a phone" });
    await pair.getByLabel("Route").selectOption({ label: `${url} · Home network` });
    await pair.getByRole("button", { name: "Show pairing code" }).click();
    const qr = page.getByRole("dialog", { name: "Scan with the FamilyFi app" });
    await expect(qr.getByTestId("pairing-payload")).toContainText('"trustMode":"pinned"');
    await expect(qr.getByTestId("pairing-code")).toHaveCount(0);
    await shot(page, "pinned-qr");
    await qr.getByRole("button", { name: "Cancel" }).click();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    const headers = await csrf(page);
    const list = (await (await page.request.get("/api/v1/connection/endpoints")).json()) as { endpoints: { id: string; url: string }[] };
    for (const endpoint of list.endpoints.filter((item) => item.url === url)) {
      await page.request.delete(`/api/v1/connection/endpoints/${endpoint.id}`, { headers });
    }
  }
});
