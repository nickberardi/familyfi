/**
 * `info.x-oldest-client` claims that every app built from that contract version on can still read
 * this server. This proves it: the shared `src/lib` as it stood when `info.version` first became
 * that floor, which is what such an app vendors, loads the dev seed household from today's route
 * handlers and draws what the app's Family, Rules and Checkup screens draw from it. Any throw fails.
 * Release 0.30 crashed exactly so when API 0.34 stopped sending the quarantine rule's `groupIds`.
 * `GET /api/v1/health` tells every client the floor, so it is checked here too.
 *
 * The functions called are the old version's, by its names: when the floor rises past a rename,
 * this test follows the new floor's names. It reads git history, so CI checks out every commit.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";
import { ApiError, type ApiRequest } from "@/lib/api-client";
import { API_VERSION, OLDEST_CLIENT_API_VERSION } from "@/lib/api-compat";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as runCheckup } from "@/app/api/v1/checkup/run/route";
import { GET as getHealth } from "@/app/api/v1/health/route";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { ensureDevDummyData } from "@/server/dev-seed";
import { saveUnifiConnection } from "@/server/unifi-settings";
import { DEV_MOCK_API_KEY, DEV_MOCK_BASE_URL, resetDevMockClientForTests } from "@/server/unifi/dev-mock";
import { ensureUpstreamCategories } from "@/server/upstream-seed";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

const repoRoot = path.resolve(__dirname, "../..");
const SPEC = "openapi/familyfi.v1.yaml";
const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";

const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();

/** The first commit whose `info.version` is the floor; none while the floor is this change's own version. */
function floorCommit(): string | null {
  const escaped = OLDEST_CLIENT_API_VERSION.replaceAll(".", "\\.");
  const commits = git("log", "--first-parent", "--reverse", "--format=%H", `-G^  version: ${escaped}$`, "HEAD", "--", SPEC);
  const first = commits.split("\n").find(Boolean) ?? null;
  if (!first && OLDEST_CLIENT_API_VERSION !== API_VERSION) {
    throw new Error(
      `No commit carries info.version ${OLDEST_CLIENT_API_VERSION} (x-oldest-client). This test reads git history: ` +
        "check out every commit (actions/checkout fetch-depth: 0).",
    );
  }
  return first;
}

/** That commit's `src/lib`, extracted under build/ with its `@/lib` imports made relative. */
function extractLib(commit: string): string {
  const dir = path.join(repoRoot, "build/oldest-client", commit.slice(0, 12));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const archive = execFileSync("git", ["archive", commit, "src/lib", "package.json"], { cwd: repoRoot });
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  const lib = path.join(dir, "src/lib");
  const walk = (folder: string): string[] =>
    readdirSync(folder).flatMap((name) => {
      const file = path.join(folder, name);
      return statSync(file).isDirectory() ? walk(file) : [file];
    });
  for (const file of walk(lib).filter((name) => name.endsWith(".ts"))) {
    const text = readFileSync(file, "utf8");
    const relative = text.replace(/from "@\/lib\/([^"]+)"/g, (_, target: string) => {
      const to = path.relative(path.dirname(file), path.join(lib, target));
      return `from "${to.startsWith(".") ? to : `./${to}`}"`;
    });
    if (relative !== text) writeFileSync(file, relative);
  }
  return lib;
}

type RouteModule = Record<string, (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>>;

/** Today's route handlers by path pattern, so the old client can call whatever it calls. */
function routeTable(): { pattern: RegExp; names: string[]; file: string }[] {
  const api = path.join(repoRoot, "src/app/api/v1");
  const walk = (folder: string): string[] =>
    readdirSync(folder).flatMap((name) => {
      const file = path.join(folder, name);
      return statSync(file).isDirectory() ? walk(file) : name === "route.ts" ? [file] : [];
    });
  return walk(api).map((file) => {
    const names: string[] = [];
    const segments = path
      .relative(api, path.dirname(file))
      .split(path.sep)
      .filter(Boolean)
      .map((segment) => {
        const param = /^\[(.+)\]$/.exec(segment);
        if (!param) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(param[1]!);
        return "([^/]+)";
      });
    return { pattern: new RegExp(`^/api/v1${segments.length ? `/${segments.join("/")}` : ""}$`), names, file };
  });
}

function serverRequest(auth: SessionAuth): ApiRequest {
  const routes = routeTable();
  return async <T,>(target: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
    const method = init.method ?? "GET";
    const url = new URL(target, "http://familyfi.test");
    const route = routes.find(({ pattern }) => pattern.test(url.pathname));
    if (!route) throw new ApiError(`No route for ${url.pathname}`, 404, "not_found");
    const values = route.pattern.exec(url.pathname)!.slice(1);
    const handler = ((await import(route.file)) as RouteModule)[method];
    if (!handler) throw new ApiError(`${method} ${url.pathname} is not allowed`, 405);
    const response = await handler(
      request(`${url.pathname}${url.search}`, {
        method,
        auth,
        ...(init.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
      }),
      { params: Promise.resolve(Object.fromEntries(route.names.map((name, index) => [name, values[index]!]))) },
    );
    const body = (await response.json()) as T & { error?: { message?: string; code?: string } };
    if (!response.ok) throw new ApiError(body.error?.message ?? `HTTP ${response.status}`, response.status, body.error?.code);
    return body;
  };
}

// The old version's modules, typed as today's: a signature that changed since fails at run time.
type Old = {
  store: typeof import("@/lib/household-store");
  groupActions: typeof import("@/lib/group-actions");
  rules: typeof import("@/lib/rules");
  display: typeof import("@/lib/display");
  marks: typeof import("@/lib/category-marks");
  ruleList: typeof import("@/lib/rule-list");
  checkup: typeof import("@/lib/checkup");
};

describe(`the oldest client the server serves (x-oldest-client ${OLDEST_CLIENT_API_VERSION})`, () => {
  const previousMode = process.env.FAMILYFI_MODE;
  let lib = path.join(repoRoot, "src/lib");
  let extracted: string | null = null;

  beforeAll(async () => {
    const commit = floorCommit();
    if (commit) lib = extracted = extractLib(commit);
    process.env.FAMILYFI_MODE = "dev";
    resetDevMockClientForTests();
    setReconcileClientForTests(undefined);
    await resetDatabase();
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    await ensureUpstreamCategories();
    await ensureDevDummyData();
    expect(await runReconcileOnce()).toBe(true);
  });

  afterAll(() => {
    if (previousMode === undefined) delete process.env.FAMILYFI_MODE;
    else process.env.FAMILYFI_MODE = previousMode;
    setReconcileClientForTests(undefined);
    resetDevMockClientForTests();
    if (extracted) rmSync(path.dirname(extracted), { recursive: true, force: true });
  });

  it("loads the household and draws every Family, Rules and Checkup screen without a throw", async () => {
    const response = await login(
      request("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
      }),
    );
    expect(response.status).toBe(200);
    const auth = authFromLogin(response);
    expect((await runCheckup(request("/api/v1/checkup/run", { method: "POST", auth, headers: { "content-type": "application/json" }, body: "{}" }))).ok).toBe(true);
    const send = serverRequest(auth);

    const load = async <K extends keyof Old>(name: string) => (await import(path.join(lib, `${name}.ts`))) as Old[K];
    const old: Old = {
      store: await load<"store">("household-store"),
      groupActions: await load<"groupActions">("group-actions"),
      rules: await load<"rules">("rules"),
      display: await load<"display">("display"),
      marks: await load<"marks">("category-marks"),
      ruleList: await load<"ruleList">("rule-list"),
      checkup: await load<"checkup">("checkup"),
    };

    const store = old.store.createHouseholdStore({ request: send });
    await store.reload();
    const state = store.getState();
    expect(state).toMatchObject({ status: "ready", error: "" });
    expect(state.groups.length).toBeGreaterThan(0);
    expect(state.rules.length).toBeGreaterThan(0);

    const timezone = state.household?.timezone ?? "UTC";
    const now = new Date();
    const names = new Map<string, string>();
    const { categories } = await send<{ categories: Parameters<typeof old.marks.categorySlotStates>[2] }>("/api/v1/upstream/categories");

    // Family: each card, its header and rule actions, and its category marks.
    for (const group of state.groups) {
      const windows = old.rules.internetWindowsForGroup(state.rules, group.id, now);
      old.display.cardStateLabel(group, windows, timezone, now);
      old.display.cardNoteLine(group, windows);
      old.groupActions.groupStatus(group, state.rules, timezone, now);
      old.groupActions.groupHeaderActions(group, state.rules, timezone, now);
      old.groupActions.groupRuleActions(group, old.rules.internetRulesForGroup(state.rules, group.id), now);
      old.groupActions.rulesBlockingGroup(group, state.rules, timezone, now);
      old.rules.groupScopedRules(state.rules, group.id);
      old.rules.appRulesForGroup(state.rules, group.id);
      const slots = old.marks.categorySlotStates(group, state.rules, categories, timezone, now);
      for (const open of [false, true]) old.marks.cardMarks(slots, { open, more: true });
      for (const slot of slots) old.marks.categorySheet(slot);
    }

    // Rules: the list for the household and for each group, and every rule's card.
    old.ruleList.rulesListView(state.rules, state.groups, null);
    for (const group of state.groups) old.ruleList.rulesListView(state.rules, state.groups, group.id);
    for (const rule of state.rules) {
      old.ruleList.ruleStatus(rule, timezone, now);
      old.ruleList.ruleWhenLines(rule);
      old.ruleList.ruleCardDimmed(rule, now);
      old.ruleList.ruleMarkSpec(rule);
      old.ruleList.ruleBarBands(rule);
      old.rules.ruleBlocksLabel(rule, names);
      old.rules.parentFacingRuleLabel(rule, names);
    }

    // Checkup: its sections, summary and every finding's copy.
    const { checkup } = await send<{ checkup: Parameters<typeof old.checkup.checkupSummary>[0] & object }>("/api/v1/checkup");
    expect(checkup.findings.length).toBeGreaterThan(0);
    old.checkup.checkupSections(checkup);
    old.checkup.checkupSummary(checkup, now);
    for (const finding of checkup.findings) old.checkup.checkupCopy(finding);
  });
});

describe("the versions GET /api/v1/health reports", () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it("names the contract and its oldest client to anyone, over the tunnel too", async () => {
    const info = YAML.parse(readFileSync(path.join(repoRoot, SPEC), "utf8")).info as Record<string, string>;
    for (const headers of [{}, { "x-familyfi-via": "tunnel" }] as Record<string, string>[]) {
      const response = await getHealth(request("/api/v1/health", { headers }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        version: API_VERSION,
        apiVersion: info.version,
        minAppApiVersion: info["x-oldest-client"],
      });
    }
  });
});
