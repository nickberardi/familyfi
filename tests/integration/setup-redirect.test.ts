import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { resetDatabase } from "../helpers/db";

/**
 * Home is where a browser lands: a household with no gateway yet starts with first-time setup,
 * signed in or not, and every other household opens on Family, or sign-in without a session.
 * Setup is open before sign-in only until the household has a gateway.
 */
let sessionCookie: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (sessionCookie ? { value: sessionCookie } : undefined) }),
}));
// The pages' client components draw with React Native primitives; only what the pages hand them matters here.
vi.mock("@/components/setup/SetupFlow", () => ({ SetupFlow: () => null }));
vi.mock("@/components/SignInForm", () => ({ SignInForm: () => null }));
vi.mock("@/components/ui/Logo", () => ({ Logo: () => null }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { default: Home } = await import("@/app/page");
const { default: SetupPage } = await import("@/app/setup/page");
const { default: LoginPage } = await import("@/app/login/page");
const { recoveryPassword } = await import("@/server/env");

/** Where a page redirects, or what it rendered when it did not. */
async function visit(page: () => Promise<unknown>): Promise<string | { props: Record<string, unknown> }> {
  try {
    return (await page()) as { props: Record<string, unknown> };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) return error.message.slice("redirect:".length);
    throw error;
  }
}

async function landing(): Promise<string> {
  const result = await visit(Home);
  if (typeof result !== "string") throw new Error("Home did not redirect.");
  return result;
}

const saveGateway = () => prisma().household.update({ where: { id: "default" }, data: { unifiKeyLastFour: "abcd" } });

describe("home", () => {
  beforeEach(async () => {
    await resetDatabase();
    sessionCookie = "signed-in";
  });

  it("sends a household with no gateway key to setup", async () => {
    expect(await landing()).toBe("/setup");
  });

  it("opens Family once a gateway key is saved", async () => {
    await saveGateway();
    expect(await landing()).toBe("/family");
  });

  it("sends a new install to setup before anyone has signed in", async () => {
    sessionCookie = undefined;
    expect(await landing()).toBe("/setup");
  });

  it("sends a browser with no session to sign in once a gateway key is saved", async () => {
    await saveGateway();
    sessionCookie = undefined;
    expect(await landing()).toBe("/login");
  });
});

describe("setup before sign-in", () => {
  beforeEach(async () => {
    await resetDatabase();
    sessionCookie = undefined;
  });

  it("hands a new install the admin password, and sign-in sends it to setup", async () => {
    expect(await visit(SetupPage)).toMatchObject({ props: { signedIn: false, password: recoveryPassword() } });
    expect(await visit(LoginPage)).toBe("/setup");
  });

  it("closes once a gateway key is saved, and never carries the password again", async () => {
    await saveGateway();
    expect(await visit(SetupPage)).toBe("/login");
    // A cookie that names no session is not signed in.
    sessionCookie = "not-a-session";
    expect(await visit(SetupPage)).toBe("/login");
    expect(typeof (await visit(LoginPage))).toBe("object");
  });
});
