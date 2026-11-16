import { z } from "zod";
import { readBody, withMutation, withSession } from "@/server/guard";
import { clearHouseholdResolver, getHouseholdResolver, setHouseholdResolver } from "@/server/upstream/household-resolver";

export async function GET(request: Request) {
  return withSession(request, async () => Response.json({ resolver: await getHouseholdResolver() }));
}

const PutBody = z.object({
  url: z.string().min(1).optional(),
  probeEnabled: z.boolean().optional(),
  probeTime: z.string().optional(),
  probeDays: z.array(z.number().int().min(0).max(6)).optional(),
  timeoutMs: z.number().int().min(500).max(30000).optional(),
});

export async function PUT(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, PutBody, "Invalid resolver settings.");
    if (!parsed.ok) return parsed.response;
    return Response.json({ resolver: await setHouseholdResolver(parsed.data) });
  }, { demoLock: true });
}

export async function DELETE(request: Request) {
  return withMutation(request, async () => {
    await clearHouseholdResolver();
    return Response.json({ ok: true });
  }, { demoLock: true });
}
