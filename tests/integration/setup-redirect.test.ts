import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { resetDatabase } from "../helpers/db";

/**
 * Home is where a browser lands after sign-in: a household with no gateway yet starts with
 * first-time setup, and every other household opens on Family.
 */
let sessionCookie: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (sessionCookie ? { value: sessionCookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { default: Home } = await import("@/app/page");

async function landing(): Promise<string> {
  try {
    await Home();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) return error.message.slice("redirect:".length);
    throw error;
  }
  throw new Error("Home did not redirect.");
}

describe("home after sign-in", () => {
  beforeEach(async () => {
    await resetDatabase();
    sessionCookie = "signed-in";
  });

  it("sends a household with no gateway key to setup", async () => {
    expect(await landing()).toBe("/setup");
  });

  it("opens Family once a gateway key is saved", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { unifiKeyLastFour: "abcd" } });
    expect(await landing()).toBe("/family");
  });

  it("sends a browser with no session to sign in", async () => {
    sessionCookie = undefined;
    expect(await landing()).toBe("/login");
  });
});
