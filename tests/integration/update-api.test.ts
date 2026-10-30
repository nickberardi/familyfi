import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getUpdate } from "@/app/api/v1/settings/update/route";
import { POST as checkNow } from "@/app/api/v1/settings/update/check/route";
import { POST as install } from "@/app/api/v1/settings/update/install/route";
import { PUT as putSchedule } from "@/app/api/v1/settings/update/schedule/route";
import { PUT as putHousehold } from "@/app/api/v1/settings/household/route";
import { APP_VERSION } from "@/lib/version";
import type { UpdateCheck, UpdateRun, UpdateSettings } from "@/lib/types";
import { prisma } from "@/server/db";
import { getUpdateCheckSnapshot, refreshUpdateCheck } from "@/server/update-check";
import {
  autoUpdateArmedForTests,
  rescheduleAutoUpdate,
  runAutoUpdateCatchUpForTests,
  setBackupFailureFileForTests,
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
  history: { entries: [] as Array<{ timestamp: string; scanned?: number; updated: number; failed: number; skipped: number; scan_failed?: boolean }> },
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
      // Cron needs a day even while the schedule is off.
      { enabled: false, days: [], time: "03:00" },
      { enabled: true, days: [7], time: "03:00" },
      { enabled: true, days: [1] },
    ]) {
      expect((await putSchedule(write(auth, "/api/v1/settings/update/schedule", "PUT", body))).status).toBe(400);
    }
    const saved = await putSchedule(write(auth, "/api/v1/settings/update/schedule", "PUT", { enabled: true, days: [3, 1, 3], time: "02:30" }));
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as UpdateSettings).schedule).toEqual({ enabled: true, days: [1, 3], time: "02:30" });
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household).toMatchObject({ updateScheduleEnabled: true, updateSchedule: "30 2 * * 1,3" });
    const off = await putSchedule(write(auth, "/api/v1/settings/update/schedule", "PUT", { enabled: false, days: [1, 3], time: "02:30" }));
    expect(((await off.json()) as UpdateSettings)).toMatchObject({ schedule: { enabled: false, days: [1, 3], time: "02:30" }, nextRunAt: null });
  });
});

describe("checking now", () => {
  it("answers with the release check, as health reports it, and needs the CSRF token", async () => {
    const auth = await adminAuth();
    const response = await checkNow(write(auth, "/api/v1/settings/update/check", "POST"));
    expect(response.status).toBe(200);
    const { update } = (await response.json()) as { update: UpdateCheck };
    expect(update).toEqual(getUpdateCheckSnapshot());
    expect(update).toMatchObject({ status: "ok", available: true, latestVersion: NEWER });
    const forged = await checkNow(request("/api/v1/settings/update/check", { method: "POST", auth: { ...auth, csrf: "" } }));
    expect(forged.status).toBe(403);
  });
});

describe("installing", () => {
  it("asks Watchtower once with its token, and refuses a second install meanwhile", async () => {
    const auth = await adminAuth();
    const response = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(response.status).toBe(202);
    const { run } = (await response.json()) as { run: UpdateRun };
    expect(run).toEqual({ targetVersion: NEWER, status: "requested", requestedAt: expect.any(String), error: null });
    expect(watchtower.seen.filter((call) => call.method === "POST")).toEqual([{ method: "POST", url: "/v1/update?async=true", authorization: `Bearer ${TOKEN}` }]);

    const again = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("update_in_progress");
    expect(watchtower.seen.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).toMatchObject({
      updateRequestedAt: new Date(run.requestedAt),
      updateTargetVersion: NEWER,
      updateStatus: "requested",
      updateError: null,
    });
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
    expect(lastRun).toMatchObject({ status: "skipped", error: "Watchtower skipped the update; its log says why." });
    expect(watchtower.seen.some((call) => call.method === "GET" && call.url.startsWith("/v1/history?since="))).toBe(true);
  });

  it("says the backup failed when Watchtower skipped the update for it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-backups-"));
    setBackupFailureFileForTests(path.join(dir, "last-failure"));
    try {
      const auth = await adminAuth();
      expect((await install(write(auth, "/api/v1/settings/update/install", "POST"))).status).toBe(202);
      writeFileSync(path.join(dir, "last-failure"), "pg_dump failed\n");
      watchtower.history = { entries: [{ timestamp: new Date(Date.now() + 1000).toISOString(), scanned: 1, updated: 0, failed: 0, skipped: 1 }] };
      expect((await settings(auth)).lastRun).toMatchObject({
        status: "failed",
        error: `The backup before installing failed (pg_dump failed), so FamilyFi kept running v${APP_VERSION}. The FamilyFi log says more.`,
      });
    } finally {
      setBackupFailureFileForTests(undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("calls a run settled before the release arrived a success once it runs", async () => {
    const auth = await adminAuth();
    expect((await install(write(auth, "/api/v1/settings/update/install", "POST"))).status).toBe(202);
    const { updateRequestedAt } = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const late = new Date(updateRequestedAt!.getTime() + 31 * 60_000);
    expect(await settleUpdateRun({ now: () => late })).toMatchObject({ status: "failed" });
    // The pull took longer than the time limit; Watchtower then started the new release.
    expect(await settleUpdateRun({ currentVersion: NEWER })).toMatchObject({ status: "succeeded", error: null });
    // A newer release than the run named leaves that run's outcome as it was.
    await prisma().household.update({ where: { id: "default" }, data: { updateStatus: "failed" } });
    expect(await settleUpdateRun({ currentVersion: "999.1.0" })).toMatchObject({ status: "failed" });
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
    // Busy with an install an earlier request asked for, which the time limit settled: that install is
    // this one, so the request stays open for it to settle.
    watchtower.updateStatus = 429;
    const busy = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(busy.status).toBe(202);
    expect((await settings(auth)).lastRun).toMatchObject({ status: "requested", error: null });
    expect(await settleUpdateRun({ currentVersion: NEWER })).toMatchObject({ status: "succeeded" });

    watchtower.updateStatus = 500;
    const broken = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(broken.status).toBe(502);
    expect(((await broken.json()) as { error: { code: string } }).error.code).toBe("updater_unreachable");
    expect((await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).updateStatus).toBe("failed");
  });

  it("installs nothing when only the token is there and Watchtower is not, now or on schedule", async () => {
    const auth = await adminAuth();
    process.env.FAMILYFI_UPDATER_URL = "http://127.0.0.1:1";
    setUpdaterTokenFileForTests(tokenFile);
    const response = await install(write(auth, "/api/v1/settings/update/install", "POST"));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("updater_not_configured");
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "America/New_York", updateSchedule: "0 3 * * 0,1,2,3,4,5,6" } });
    const fetchImpl: typeof fetch = async (input, init) =>
      String(input).startsWith("https://api.github.com/")
        ? releases(NEWER)()
        : String(input).startsWith("https://ghcr.io/")
          ? new Response(null, { status: 404 })
          : fetch(input, init);
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, now: () => new Date("2026-10-14T07:10:00.000Z") })).toBe("retry");
    expect((await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).updateRequestedAt).toBeNull();
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
  // GHCR answers nothing here, so the check offers by GitHub's labels.
  const fetchImpl: typeof fetch = async (input, init) =>
    github(String(input)) ? releases(NEWER)() : String(input).startsWith("https://ghcr.io/") ? new Response(null, { status: 404 }) : fetch(input, init);

  it("installs once for each scheduled instant, and not when the instant was missed by over an hour", async () => {
    // Every day at 03:00 New York time; 03:10 on 2026-10-14 is ten minutes after the due instant.
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "America/New_York", updateSchedule: "0 3 * * 0,1,2,3,4,5,6" } });
    const due = new Date("2026-10-14T07:00:00.000Z");
    const now = () => new Date(due.getTime() + 10 * 60_000);
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, now })).toBe("installed");
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, now })).toBe("nothing");
    const installed = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(installed).toMatchObject({ updateTargetVersion: NEWER, updateStatus: "requested", updateScheduleLastRunAt: due });

    const missed = () => new Date(due.getTime() + 24 * 60 * 60_000 + 2 * 60 * 60_000);
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, now: missed })).toBe("nothing");
    expect(watchtower.seen.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("does nothing while switched off or without the updater", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { updateScheduleEnabled: false } });
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl })).toBe("nothing");
    await prisma().household.update({ where: { id: "default" }, data: { updateScheduleEnabled: true } });
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, settings: null })).toBe("nothing");
    expect(watchtower.seen).toEqual([]);
  });

  it("leaves the slot unclaimed when the release check fails, so it is tried again", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "America/New_York", updateSchedule: "0 3 * * 0,1,2,3,4,5,6" } });
    const now = () => new Date("2026-10-14T07:10:00.000Z");
    const failing: typeof fetch = async (input, init) =>
      github(String(input)) || String(input).startsWith("https://ghcr.io/") ? new Response("busy", { status: 503 }) : fetch(input, init);
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl: failing, now })).toBe("retry");
    expect((await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).updateScheduleLastRunAt).toBeNull();
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, now })).toBe("installed");
  });

  it("gives the slot back when Watchtower fails the request, so it is tried again", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "America/New_York", updateSchedule: "0 3 * * 0,1,2,3,4,5,6" } });
    const now = () => new Date("2026-10-14T07:10:00.000Z");
    watchtower.updateStatus = 500;
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, now })).toBe("retry");
    expect((await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).updateScheduleLastRunAt).toBeNull();
    watchtower.updateStatus = 202;
    expect(await runAutoUpdateCatchUpForTests({ fetchImpl, now: () => new Date("2026-10-14T07:25:00.000Z") })).toBe("installed");
  });

  it("is armed again when the household's time zone changes", async () => {
    const auth = await adminAuth();
    stopAutoUpdateForTests();
    expect(autoUpdateArmedForTests()).toBe(false);
    const response = await putHousehold(write(auth, "/api/v1/settings/household", "PUT", { timezone: "America/Los_Angeles" }));
    expect(response.status).toBe(200);
    await expect.poll(() => autoUpdateArmedForTests()).toBe(true);
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
