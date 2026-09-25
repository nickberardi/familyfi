import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const password = process.env.FAMILYFI_DEFAULT_PASSWORD;
const shots = process.env.PHONES_SCREENSHOT_DIR;

// Remote access publishes one route for the whole household, so the tests that switch it run one
// at a time and in one viewport (`@desktop`); the phone viewport only checks the layout.
test.describe.configure({ mode: "serial" });

type Route = { id: string; url: string; kind: string; enabled: boolean };

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

async function routes(page: Page): Promise<Route[]> {
  return ((await (await page.request.get("/api/v1/connection/endpoints")).json()) as { endpoints: Route[] }).endpoints;
}

/** The routes phones are handed: after any switch, exactly the published one or none. */
async function enabledUrls(page: Page): Promise<string[]> {
  return (await routes(page)).filter((route) => route.enabled).map((route) => route.url);
}

/** Leaves remote access Off and deletes the household's own routes this test made. */
async function cleanUp(page: Page, urls: string[]) {
  await signIn(page);
  const headers = await csrf(page);
  await page.request.put("/api/v1/connection/tunnel", { headers, data: { mode: "off" } });
  for (const route of (await routes(page)).filter((item) => item.kind === "own" && urls.includes(item.url))) {
    await page.request.delete(`/api/v1/connection/endpoints/${route.id}`, { headers });
  }
}

async function publishHomeNetwork(page: Page, url: string) {
  const card = page.getByTestId("remote-access");
  await card.getByRole("button", { name: "My domain" }).click();
  await card.getByRole("group", { name: "How phones reach home" }).getByRole("button", { name: "Home network" }).click();
  await card.getByLabel("Address").fill(url);
  return card;
}

test("publishes a home-network route, pairs a phone through it, and revokes it", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  const url = `https://pair-e2e-${Date.now()}.home`;
  page.on("dialog", (dialog) => void dialog.accept());

  try {
    await page.goto("/pair");
    await expect(page.getByRole("heading", { name: "Pair Device" })).toBeVisible();
    await page.getByTestId("remote-access").getByRole("button", { name: "Off" }).click();
    // Nothing is published while Off, so there is nothing to pair through.
    await expect(page.getByRole("button", { name: "Pair a phone" })).toHaveCount(0);
    await expect(page.getByText("Turn on remote access, then pair a phone.")).toBeVisible();

    const card = await publishHomeNetwork(page, url);
    await expect(card.getByRole("link", { name: /Set up a VPN or reverse proxy/ })).toHaveAttribute("href", /\/wiki\/Remote-access-home-network$/);
    await shot(page, "home-network-form");
    await card.getByRole("button", { name: "Use this address" }).click();
    await expect(card.getByTestId("remote-url")).toHaveText(url);
    await expect(card.getByTestId("remote-status")).toHaveText("On");
    expect(await enabledUrls(page)).toEqual([url]);

    await page.getByRole("button", { name: "Pair a phone" }).click();
    const pairSheet = page.getByRole("dialog", { name: "Pair a phone" });
    await expect(pairSheet.getByTestId("pairing-route")).toContainText(url);
    await pairSheet.getByRole("button", { name: "Show pairing code" }).click();

    const qrSheet = page.getByRole("dialog", { name: "Scan with the FamilyFi app" });
    await expect(qrSheet.getByRole("img", { name: "Pairing QR code" })).toBeVisible();
    await expect(qrSheet.getByTestId("pairing-address")).toHaveText(url);
    await expect(qrSheet.getByTestId("pairing-countdown")).toContainText(/Expires in [45]:\d\d/);
    await shot(page, "qr-sheet");

    const code = (await qrSheet.getByTestId("pairing-code").textContent()) ?? "";
    const dot = code.indexOf(".");
    const claim = await page.request.post(`/api/v1/connection/pairings/${code.slice(0, dot)}/claim`, {
      data: { token: code.slice(dot + 1), deviceName: "Playwright iPhone" },
    });
    expect(claim.ok()).toBe(true);
    const claimed = (await claim.json()) as { device: { id: string }; deviceCredential: string };

    await expect(page.getByTestId("pairing-claimed")).toContainText("Paired Playwright iPhone", { timeout: 10_000 });
    const native = await page.request.post("/api/v1/auth/login", {
      data: { username: "admin", password, client: "native", deviceId: claimed.device.id, deviceCredential: claimed.deviceCredential },
    });
    const { token } = (await native.json()) as { token: string };
    const bearer = { authorization: `Bearer ${token}` };
    expect((await page.request.get("/api/v1/connection", { headers: bearer })).status()).toBe(200);

    await page.getByRole("dialog", { name: "Phone paired" }).getByRole("button", { name: "Done" }).click();
    await expect(card.getByTestId("published-route")).toContainText("1 phone paired here");
    const row = page.getByTestId("phone-row").filter({ hasText: "Playwright iPhone" }).filter({ hasText: url });
    await expect(row).toBeVisible();
    await shot(page, "paired");
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toHaveCount(0);

    // A revoked phone's bearer session is gone: its next request is rejected and it must pair again.
    await page.context().clearCookies();
    expect((await page.request.get("/api/v1/connection", { headers: bearer })).status()).toBe(401);
  } finally {
    await cleanUp(page, [url]);
  }
});

test("pins a home-network certificate from a pasted PEM and hands out the full payload", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  const url = `https://pinned-e2e-${Date.now()}.home`;
  const dir = mkdtempSync(path.join(tmpdir(), "familyfi-pin-e2e-"));
  page.on("dialog", (dialog) => void dialog.accept());
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2", "-subj", "/CN=familyfi.home", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem")], { stdio: "ignore" });
    const certificate = readFileSync(path.join(dir, "c.pem"), "utf8");

    await page.goto("/pair");
    const card = await publishHomeNetwork(page, url);
    await card.getByRole("button", { name: "Pin this certificate" }).click();
    await card.getByRole("button", { name: "Paste certificate instead" }).click();
    await card.getByLabel("Certificate (PEM)").fill(certificate);
    await card.getByRole("button", { name: "Use this certificate" }).click();
    await expect(card.getByTestId("certificate-read")).toContainText("CN=familyfi.home");
    await expect(card.getByLabel("SPKI SHA-256 pin")).toHaveValue(/^[A-Za-z0-9_-]{43}$/);
    await shot(page, "pinned-form");
    await card.getByRole("button", { name: "Use this address" }).click();

    const saved = card.getByTestId("saved-route");
    await expect(saved).toContainText(url);
    await expect(saved).toContainText("Pinned");
    // Nothing answers at this made-up address: the check must say it could not look, never "matches".
    await saved.getByRole("button", { name: "Check" }).click();
    await expect(saved.getByTestId("pin-check")).toContainText("Couldn't check", { timeout: 10_000 });

    await page.getByRole("button", { name: "Pair a phone" }).click();
    await page.getByRole("dialog", { name: "Pair a phone" }).getByRole("button", { name: "Show pairing code" }).click();
    const qr = page.getByRole("dialog", { name: "Scan with the FamilyFi app" });
    await expect(qr.getByTestId("pairing-payload")).toContainText('"trustMode":"pinned"');
    await expect(qr.getByTestId("pairing-code")).toHaveCount(0);
    await shot(page, "pinned-qr");
    await qr.getByRole("button", { name: "Cancel" }).click();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await cleanUp(page, [url]);
  }
});

test("switches between saved routes and Off, publishing exactly one at a time", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  const stamp = Date.now();
  const home = `https://switch-home-${stamp}.home`;
  const tailnet = `https://switch-${stamp}.tail1234.ts.net`;
  page.on("dialog", (dialog) => void dialog.accept());
  try {
    await page.goto("/pair");
    const card = await publishHomeNetwork(page, home);
    await card.getByRole("button", { name: "Use this address" }).click();
    await expect(card.getByTestId("remote-url")).toHaveText(home);

    const via = card.getByRole("group", { name: "How phones reach home" });
    await via.getByRole("button", { name: "Tailscale" }).click();
    await expect(card.getByRole("link", { name: /Set up the Tailscale sidecar/ })).toHaveAttribute("href", /\/wiki\/Remote-access-Tailscale$/);
    await card.getByLabel("Address").fill(tailnet);
    await card.getByRole("button", { name: "Use this address" }).click();
    await expect(card.getByTestId("remote-url")).toHaveText(tailnet);
    expect(await enabledUrls(page)).toEqual([tailnet]);

    // The home-network route is still saved: switching back publishes it without retyping.
    await via.getByRole("button", { name: "Home network" }).click();
    await card.getByTestId("saved-route").getByRole("button", { name: "Use this route" }).click();
    await expect(card.getByTestId("remote-url")).toHaveText(home);
    expect(await enabledUrls(page)).toEqual([home]);

    await card.getByRole("button", { name: "Off" }).click();
    await expect(card.getByTestId("remote-url")).toHaveCount(0);
    expect(await enabledUrls(page)).toEqual([]);
    await expect(page.getByRole("button", { name: "Pair a phone" })).toHaveCount(0);

    // Advanced is not built yet (#69): it says so and offers nothing to fill in.
    await card.getByRole("button", { name: "My domain" }).click();
    await via.getByRole("button", { name: "Cloudflare Tunnel" }).click();
    await card.getByRole("group", { name: "Cloudflare setup" }).getByRole("button", { name: "Advanced" }).click();
    await expect(card.getByTestId("cloudflare-advanced")).toContainText("Coming soon");
    await expect(card.getByLabel("Address")).toHaveCount(0);
    await shot(page, "cloudflare-advanced");
  } finally {
    await cleanUp(page, [home, tailnet]);
  }
});

test("re-pairs a revoked phone in place and removes another", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  const url = `https://revoked-e2e-${Date.now()}.home`;
  const tag = `${Date.now()}`;
  page.on("dialog", (dialog) => void dialog.accept());
  const headers = await csrf(page);
  const route = ((await (await page.request.post("/api/v1/connection/endpoints", { headers, data: { url, transport: "lan", trustMode: "system" } })).json()) as { endpoint: { id: string } }).endpoint.id;
  await page.request.put("/api/v1/connection/tunnel", { headers, data: { mode: "named", endpointId: route } });

  async function pairAndRevoke(name: string) {
    const { pairing } = (await (await page.request.post("/api/v1/connection/pairings", { headers, data: { endpointId: route, deviceName: name } })).json()) as { pairing: { id: string; qr: { token: string } } };
    const claimed = (await (await page.request.post(`/api/v1/connection/pairings/${pairing.id}/claim`, { data: { token: pairing.qr.token, deviceName: name } })).json()) as { device: { id: string } };
    await page.request.delete(`/api/v1/connection/devices/${claimed.device.id}`, { headers });
  }

  try {
    await pairAndRevoke(`Old phone ${tag}`);
    await pairAndRevoke(`Lost phone ${tag}`);
    await page.goto("/pair");
    await page.getByRole("button", { name: /Show revoked/ }).click();

    const old = page.getByTestId("phone-row").filter({ hasText: `Old phone ${tag}` });
    await old.getByRole("button", { name: "Re-pair" }).click();
    const sheet = page.getByRole("dialog", { name: `Re-pair Old phone ${tag}` });
    await expect(sheet.getByLabel("Phone", { exact: true })).toHaveValue(`Old phone ${tag}`);
    await expect(sheet.getByTestId("pairing-route")).toContainText(url);
    await sheet.getByRole("button", { name: "Show pairing code" }).click();
    const code = (await page.getByTestId("pairing-code").textContent()) ?? "";
    const dot = code.indexOf(".");
    expect((await page.request.post(`/api/v1/connection/pairings/${code.slice(0, dot)}/claim`, { data: { token: code.slice(dot + 1), deviceName: `Old phone ${tag}` } })).ok()).toBe(true);
    await expect(page.getByTestId("pairing-claimed")).toBeVisible({ timeout: 10_000 });
    await shot(page, "repaired");
    await page.getByRole("button", { name: "Done" }).click();

    // One entry for the re-paired phone, and it is active again.
    await expect(page.getByTestId("phone-row").filter({ hasText: `Old phone ${tag}` })).toHaveCount(1);
    await expect(page.getByTestId("phone-row").filter({ hasText: `Old phone ${tag}` }).getByRole("button", { name: "Revoke" })).toBeVisible();

    const lost = page.getByTestId("phone-row").filter({ hasText: `Lost phone ${tag}` });
    await lost.getByRole("button", { name: "Remove" }).click();
    await expect(lost).toHaveCount(0);
    await shot(page, "removed");
  } finally {
    const list = (await (await page.request.get("/api/v1/connection/devices")).json()) as { devices: { id: string; displayName: string }[] };
    for (const device of list.devices.filter((item) => item.displayName.includes(tag))) {
      await page.request.delete(`/api/v1/connection/devices/${device.id}?remove=true`, { headers });
    }
    await cleanUp(page, [url]);
  }
});

test("sets up remote access on a domain through the Cloudflare sign-in link", { tag: "@desktop" }, async ({ page }) => {
  await signIn(page);
  await page.goto("/pair");
  const card = page.getByTestId("remote-access");
  // Off becomes pickable once the card has loaded the server's state.
  await expect(card.getByRole("button", { name: "Off" })).toBeEnabled();
  test.skip(await card.getByRole("button", { name: "Quick tunnel" }).isDisabled(), "needs cloudflared (or CLOUDFLARED_BIN pointing at tests/fixtures/cloudflared) on the server");
  const hostname = `familyfi-${test.info().project.name}.example.com`;
  try {
    await card.getByRole("button", { name: "My domain" }).click();
    await card.getByRole("group", { name: "How phones reach home" }).getByRole("button", { name: "Cloudflare Tunnel" }).click();
    await card.getByLabel("Hostname").fill(hostname);
    await card.getByRole("button", { name: "Connect with Cloudflare" }).click();
    const link = card.getByRole("link", { name: "Open Cloudflare to authorize FamilyFi" });
    await expect(link).toHaveAttribute("href", /^https:\/\/dash\.cloudflare\.com\/argotunnel/);
    await shot(page, "remote-domain-login");
    await expect(card.getByTestId("remote-url")).toHaveText(`https://${hostname}`, { timeout: 15_000 });
    await expect(card.getByTestId("published-route")).toContainText("Cloudflare Tunnel");
    expect(await enabledUrls(page)).toEqual([`https://${hostname}`]);
    await shot(page, "remote-domain-running");
  } finally {
    await signIn(page);
    await page.request.put("/api/v1/connection/tunnel", { headers: await csrf(page), data: { mode: "off", forget: true } });
  }
});

test("lays out remote access on a phone", { tag: "@phone" }, async ({ page }) => {
  await signIn(page);
  await page.goto("/pair");
  await expect(page.getByRole("heading", { name: "Pair Device" })).toBeVisible();
  const card = page.getByTestId("remote-access");
  await expect(card.getByRole("group", { name: "Remote access" })).toBeVisible();
  for (const name of ["Off", "Quick tunnel", "My domain"]) await expect(card.getByRole("button", { name })).toBeVisible();
  await shot(page, "remote-access");
});
