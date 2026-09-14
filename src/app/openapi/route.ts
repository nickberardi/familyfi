import { readFile } from "node:fs/promises";
import path from "node:path";
import { withSession } from "@/server/guard";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const spec = await readFile(path.join(process.cwd(), "openapi/familyfi.v1.yaml"), "utf8");
    return new Response(spec, {
      headers: {
        "content-type": "application/yaml; charset=utf-8",
        "cache-control": "private, no-store",
      },
    });
  });
}
