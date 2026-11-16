import { readBody, withMutation, withSession } from "@/server/guard";
import { clearHouseholdResolver, getHouseholdResolver, HouseholdResolverBody, setHouseholdResolver } from "@/server/upstream/household-resolver";

export async function GET(request: Request) {
  return withSession(request, async () => Response.json({ resolver: await getHouseholdResolver() }));
}

export async function PUT(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, HouseholdResolverBody, "Invalid resolver settings.");
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
