import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getUpdate } from "@/app/api/v1/settings/update/route";
import { POST as install } from "@/app/api/v1/settings/update/install/route";
import { PUT as putSchedule } from "@/app/api/v1/settings/update/schedule/route";
import { APP_VERSION } from "@/lib/version";
import type { UpdateRun, UpdateSettings } from "@/lib/types";
import { prisma } from "@/server/db";
import { refreshUpdateCheck } from "@/server/update-check";
import {
  autoUpdateArmedForTests,
  rescheduleAutoUpdate,
  runAutoUpdateCatchUpForTests,
  setUpdaterTokenFileForTests,
  settleUpdateRun,
  stopAutoUpdateForTests,
} from "@/server/updater";
import { resetDatabase } from "../helpers/db";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const TOKEN = "watchtower-test-token";
const NEWER = "999.0.0";
const saved = { url: process.env.FAMILYFI_UPDATER_URL };
/** Stands in for the updater volume the entrypoint writes the shared token into. */
const tokenDir = mkdtempSync(path.join(tmpdir(), "familyfi-updater-"));
const tokenFile = path.join(tokenDir, "token");
const writeToken = (token: string) => writeFileSync(tokenFile, `${token}\n`);

/** A stand-in for the Watchtower sidecar's HTTP API: records each call and answers as told. */
type Seen = { method: string; url: string; authorization: string | undefined };
const watchtower = {
  server: undefined as Server | undefined,
  url: "",
  seen: [] as Seen[],
  updateStatus: 202,
  history: { entries: [] as Array<{ timestamp: string; updated: number; failed: number; skipped: number }> },
};

function releases(tag: string) {
  return async () => new Response(JSON.stringify([{ tag_name: `v${tag}` }]), { status: 200 });
}

async function adminAuth(): Promise<SessionAuth> {
  return authFromLogin(
    await login(
      request("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
      }),
    ),
  );
}

const write = (auth: SessionAuth, path: string, method: string, body?: unknown) =>
  request(path, { method, auth, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function settings(auth: SessionAuth): Promise<UpdateSettings> {
  const response = await getUpdate(request("/api/v1/settings/update", { auth }));
  expect(response.status).toBe(200);
  return (await response.json()) as UpdateSettings;
}

beforeAll(async () => {
  watchtower.server = createServer((req: IncomingMessage, res) => {
    watchtower.seen.push({ method: req.method ?? "", url: req.url ?? "", authorization: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end();
    } else if (req.method === "POST" && req.url?.startsWith("/v1/update")) {
      res.writeHead(watchtower.updateStatus, { "content-type": "application/json" }).end("{}");
    } else if (req.method === "GET" && req.url?.startsWith("/v1/history")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(watchtower.history));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => watchtower.server!.listen(0, "127.0.0.1", resolve));
  watchtower.url = `http://127.0.0.1:${(watchtower.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => watchtower.server?.close(() => resolve()));
  setUpdaterTokenFileForTests(undefined);
  rmSync(tokenDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDatabase();
  watchtower.seen = [];
  watchtower.updateStatus = 202;
  watchtower.history = { entries: [] };
  writeToken(TOKEN);
  setUpdaterTokenFileForTests(tokenFile);
  process.env.FAMILYFI_UPDATER_URL = watchtower.url;
  await refreshUpdateCheck({ fetchImpl: releases(NEWER) });
});

afterEach(async () => {
  stopAutoUpdateForTests();
  if (saved.url === undefined) delete process.env.FAMILYFI_UPDATER_URL;
  else process.env.FAMILYFI_UPDATER_URL = saved.url;
  await refreshUpdateCheck({ fetchImpl: releases(APP_VERSION) });
});

describe("update settings", () => {
  it("installs on Sunday at midnight by default, and is set up only while Watchtower answers to the token", async () => {
    const auth = await adminAuth();
    expect(await settings(auth)).toMatchObject({
      updater: { configured: true },
      schedule: { enabled: true, days: [0], time: "00:00" },
      lastRun: null,
    });
    expect((await settings(auth)).nextRunAt).not.toBeNull();
    // A token alone, as every image has, is not an updater: Watchtower must answer to it.
    process.env.FAMILYFI_UPDATER_URL = "http://127.0.0.1:1";
    setUpdaterTokenFileForTests(tokenFile);
    expect(await settings(auth)).toMatchObject({ updater: { configured: false }, nextRunAt: null });
    process.env.FAMILYFI_UPDATER_URL = watchtower.url;
    writeToken("not-the-token");
    setUpdaterTokenFileForTests(tokenFile);
    expect((await settings(auth)).updater.configured).toBe(false);
    setUpdaterTokenFileForTests(path.join(tokenDir, "missing"));
    expect(await settings(auth)).toMatchObject({ updater: { configured: false }, nextRunAt: null });
  });

  it("saves a schedule and refuses one it cannot keep", async () => {
    const auth = await adminAuth();
    for (const body of [
      { enabled: true, days: [1], time: "25:00" },
      { enabled: true, days: [], time: "03:00" },
      { enabled: true, days: [7], time: "03:00" },
      { enabled: true, days: [1] },
    ]) {
      expect((await putSchedule(write(auth, "/api/v1/settings/update/schedule", "PUT", body))).status).toBe(400);
    }
    const saved = await putSchedule(write(auth, "/api/v1/settings/update/schedule", "PUT", { enabled: true, days: [3, 1, 3], time: "02:30" }));
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as UpdateSettings).schedule).toEqual({ enabled: true, days: [1, 3], time: "02:30" });
    const off = await putSchedule(write(auth, "/api/v1/settings/update/schedule", "PUT", { enabled: false, days: [], time: "02:30" }));
    expect(((await off.json()) as UpdateSettings).nextRunAt).toBeNull();
  });
});

describe("installing", () => {
  it("asks Watchtower once with its token, and refuses a second install meanwhile", async () => {
    const auth = await adminAuth();
    const response = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(response.status).toBe(202);
    const { run } = (await response.json()) as { run: UpdateRun };
    expect(run).toMatchObject({ trigger: "manual", fromVersion: APP_VERSION, targetVersion: NEWER, status: "requested" });
    expect(watchtower.seen.filter((call) => call.method === "POST")).toEqual([{ method: "POST", url: "/v1/update?async=true", authorization: `Bearer ${TOKEN}` }]);

    const again = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("update_in_progress");
    expect(watchtower.seen.filter((call) => call.method === "POST")).toHaveLength(1);
    const admin = await prisma().account.findUniqueOrThrow({ where: { username: "admin" } });
    expect(await prisma().updateRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ requestedByAccountId: admin.id });
  });

  it("settles from Watchtower's history while the old release keeps running", async () => {
    const auth = await adminAuth();
    expect((await install(write(auth, "/api/v1/settings/update/install", "POST"))).status).toBe(202);
    expect((await settings(auth)).lastRun?.status).toBe("requested");
    // A scan that ended before this request belongs to an earlier one and settles nothing.
    watchtower.history = { entries: [{ timestamp: "2020-01-01T00:00:00.000000001Z", updated: 0, failed: 1, skipped: 0 }] };
    expect((await settings(auth)).lastRun?.status).toBe("requested");
    watchtower.history = { entries: [{ timestamp: new Date(Date.now() + 1000).toISOString().replace("Z", "+00:00"), updated: 0, failed: 0, skipped: 1 }] };
    const { lastRun } = await settings(auth);
    expect(lastRun).toMatchObject({ status: "skipped" });
    expect(lastRun?.finishedAt).not.toBeNull();
    expect(watchtower.seen.some((call) => call.method === "GET" && call.url.startsWith("/v1/history?since="))).toBe(true);
  });

  it("succeeds when the new release starts", async () => {
    const auth = await adminAuth();
    expect((await install(write(auth, "/api/v1/settings/update/install", "POST"))).status).toBe(202);
    const settled = await settleUpdateRun({ currentVersion: NEWER });
    expect(settled).toMatchObject({ status: "succeeded", error: null });
  });

  it("treats Watchtower refusing the token, or not answering, as no updater, and a busy one as in progress", async () => {
    const auth = await adminAuth();
    writeToken("not-the-token");
    const refused = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("updater_not_configured");

    writeToken(TOKEN);
    watchtower.updateStatus = 429;
    const busy = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { error: { code: string } }).error.code).toBe("update_in_progress");
    expect((await settings(auth)).lastRun).toMatchObject({ status: "failed", error: "Watchtower was already updating containers." });

    watchtower.updateStatus = 500;
    const broken = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(broken.status).toBe(502);
    expect(((await broken.json()) as { error: { code: string } }).error.code).toBe("updater_unreachable");
    expect(await prisma().updateRun.count({ where: { status: "requested" } })).toBe(0);
  });

  it("installs nothing when only the token is there and Watchtower is not, now or on schedule", async () => {
    const auth = await adminAuth();
    process.env.FAMILYFI_UPDATER_URL = "http://127.0.0.1:1";
    setUpdaterTokenFileForTests(tokenFile);
    const response = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("updater_not_configured");
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "America/New_York", autoUpdateDays: [0, 1, 2, 3, 4, 5, 6], autoUpdateTime: "03:00" } });
    const fetchImpl: typeof fetch = async (input, init) =>
      String(input).startsWith("https://api.github.com/") ? releases(NEWER)() : fetch(input, init);
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, now: () => new Date("2026-10-14T07:10:00.000Z") })).toBe("retry");
    expect(await prisma().updateRun.count()).toBe(0);
  });

  it("refuses without the updater or anything newer", async () => {
    const auth = await adminAuth();
    setUpdaterTokenFileForTests(path.join(tokenDir, "missing"));
    const unset = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(unset.status).toBe(409);
    expect(((await unset.json()) as { error: { code: string } }).error.code).toBe("updater_not_configured");

    setUpdaterTokenFileForTests(tokenFile);
    await refreshUpdateCheck({ fetchImpl: releases(APP_VERSION) });
    const current = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(current.status).toBe(409);
    expect(((await current.json()) as { error: { code: string } }).error.code).toBe("no_update_available");
    expect(watchtower.seen).toEqual([]);
  });
});

describe("the schedule", () => {
  const github = (url: string) => url.startsWith("https://api.github.com/");
  const fetchImpl: typeof fetch = async (input, init) =>
    github(String(input)) ? releases(NEWER)() : fetch(input, init);

  it("installs once for each scheduled instant, and not when the instant was missed by over an hour", async () => {
    // Every day at 03:00 New York time; 03:10 on 2026-10-14 is ten minutes after the due instant.
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "America/New_York", autoUpdateDays: [0, 1, 2, 3, 4, 5, 6], autoUpdateTime: "03:00" } });
    const due = new Date("2026-10-14T07:00:00.000Z");
    const now = () => new Date(due.getTime() + 10 * 60_000);
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, now })).toBe("installed");
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, now })).toBe("nothing");
    expect(await prisma().updateRun.findMany()).toMatchObject([{ trigger: "scheduled", targetVersion: NEWER }]);
    expect((await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).autoUpdateLastRunAt).toEqual(due);

    const missed = () => new Date(due.getTime() + 24 * 60 * 60_000 + 2 * 60 * 60_000);
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, now: missed })).toBe("nothing");
    expect(await prisma().updateRun.count()).toBe(1);
  });

  it("does nothing while switched off or without the updater", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { autoUpdateEnabled: false } });
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl })).toBe("nothing");
    await prisma().household.update({ where: { id: "default" }, data: { autoUpdateEnabled: true } });
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, settings: null })).toBe("nothing");
    expect(watchtower.seen).toEqual([]);
  });

  it("leaves the slot unclaimed when the release check fails, so it is tried again", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "America/New_York", autoUpdateDays: [0, 1, 2, 3, 4, 5, 6], autoUpdateTime: "03:00" } });
    const now = () => new Date("2026-10-14T07:10:00.000Z");
    const failing: typeof fetch = async (input, init) =>
      github(String(input)) ? new Response("busy", { status: 503 }) : fetch(input, init);
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl: failing, now })).toBe("retry");
    expect((await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).autoUpdateLastRunAt).toBeNull();
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, now })).toBe("installed");
  });

  it("never lets an arm overtaken by a newer one set a timer", async () => {
    rescheduleAutoUpdate();
    stopAutoUpdateForTests();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(autoUpdateArmedForTests()).toBe(false);
    rescheduleAutoUpdate();
    await expect.poll(() => autoUpdateArmedForTests()).toBe(true);
  });
});
