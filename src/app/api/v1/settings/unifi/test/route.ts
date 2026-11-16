import { readBody, withMutation } from "@/server/guard";
import { tryUnifiConnection, UnifiTestBody } from "@/server/unifi-settings";

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, UnifiTestBody, "Provide an API key and a UniFi target, or test the saved connection.");
    if (!parsed.ok) return parsed.response;
    return Response.json({ ok: true, ...(await tryUnifiConnection(parsed.data)) });
  });
}
