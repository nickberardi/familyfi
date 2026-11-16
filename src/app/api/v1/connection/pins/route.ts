import { z } from "zod";
import { readBody, withAdmin } from "@/server/guard";
import { computePin } from "@/server/spki";

const Body = z.union([z.object({ url: z.string().min(1) }).strict(), z.object({ certificate: z.string().min(1).max(20_000) }).strict()]);

export async function POST(request: Request) {
  // Routes are locked in the demo, and a probe would reach any address from the demo's host.
  return withAdmin(request, async () => {
    const parsed = await readBody(request, Body, "Send either a route url or a PEM certificate.");
    if (!parsed.ok) return parsed.response;
    return Response.json({ pin: await computePin(parsed.data) });
  }, { demoLock: true });
}
