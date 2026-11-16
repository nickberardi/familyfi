import { z } from "zod";
import { readBody, withMutation, withSession } from "@/server/guard";
import { getAlertChoices, setAlertChoices } from "@/server/alerts/registrations";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ kinds: z.record(z.string().max(64), z.boolean()) });

/** Which alert kinds the app on this device gets; only that app may read or change them. */
export async function GET(request: Request, context: Ctx) {
  return withSession(request, async (session) => {
    const { id } = await context.params;
    return Response.json({ alerts: await getAlertChoices(session, id) });
  });
}

export async function PUT(request: Request, context: Ctx) {
  return withMutation(request, async (session) => {
    const parsed = await readBody(request, Body, "Send kinds, a map of alert kind to true or false.");
    if (!parsed.ok) return parsed.response;
    const { id } = await context.params;
    return Response.json({ alerts: await setAlertChoices(session, id, parsed.data.kinds) });
  }, { demoLock: true });
}
