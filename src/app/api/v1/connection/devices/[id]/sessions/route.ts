import { SessionKind } from "@prisma/client";
import { z } from "zod";
import { createWatchSession } from "@/server/auth";
import { readJson, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";

const Body = z.object({ client: z.literal("watch"), clientId: z.string().uuid() });
type Ctx = { params: Promise<{ id: string }> };

/** A paired phone may issue a limited session for its companion client. */
export async function POST(request: Request, context: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await context.params;
    if (session.kind !== SessionKind.bearer || session.deviceId !== id || session.parentSessionId) {
      return jsonError(403, "paired_phone_required", "A paired phone can provision only its own companion session.");
    }
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "A supported client and identifier are required.");
    const issued = await createWatchSession(session, parsed.data.clientId);
    return Response.json({
      sessionId: issued.sessionId,
      token: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
    }, { status: 201 });
  });
}
