import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";
import { proxy } from "@/proxy";

function visit(path: string, cookie?: string) {
  const headers = cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : undefined;
  const response = proxy(new NextRequest(`http://familyfi.local${path}`, { headers }));
  return response.headers.get("location");
}

describe("page proxy", () => {
  it("lets a browser with no session reach setup, which decides for itself", () => {
    // Without this, a new install loops: /setup sends it to /login, which sends it back.
    expect(visit("/setup")).toBeNull();
    expect(visit("/login")).toBeNull();
  });

  it("still sends a browser with no session from other pages to sign-in", () => {
    expect(visit("/family")).toBe("http://familyfi.local/login");
    expect(visit("/family", "signed-in")).toBeNull();
  });
});
