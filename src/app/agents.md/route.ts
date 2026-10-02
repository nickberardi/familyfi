import { readFile } from "node:fs/promises";
import path from "node:path";
import { APP_VERSION } from "@/lib/version";
import { requestOrigin } from "@/server/auth";

/**
 * The guide an agent reads first, with this server's address and version filled in. It holds no
 * secrets, so it needs no session. The phone gateway passes only `/api/v1/*`, so it is never served
 * over remote access.
 */
export async function GET(request: Request) {
  const guide = await readFile(path.join(process.cwd(), "openapi/agent-guide.md"), "utf8");
  return new Response(guide.replaceAll("{{origin}}", requestOrigin(request)).replaceAll("{{version}}", APP_VERSION), {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" },
  });
}
