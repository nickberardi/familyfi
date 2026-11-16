import { readBody, withMutation } from "@/server/guard";
import { PushRegistrationInput, registerPush, removePush } from "@/server/alerts/registrations";

type Ctx = { params: Promise<{ id: string }> };

/** The app's own push token and alert key; only the app on that device may set or remove them. */
export async function PUT(request: Request, context: Ctx) {
  return withMutation(request, async (session) => {
    const parsed = await readBody(request, PushRegistrationInput, "Send platform, channel, token, key, format and kinds.");
    if (!parsed.ok) return parsed.response;
    const { id } = await context.params;
    return Response.json({ alerts: await registerPush(session, id, parsed.data) });
  }, { demoLock: true });
}

export async function DELETE(request: Request, context: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await context.params;
    await removePush(session, id);
    return Response.json({ ok: true });
  }, { demoLock: true });
}
