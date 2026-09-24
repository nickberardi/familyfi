import { SessionKind } from "@prisma/client";
import { z } from "zod";
import { createWatchSession } from "@/server/auth";
import { readJson, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";

const Body = z.object({ watchId: z.string().uuid() });

/** Only a signed-in, paired iPhone may provision its active Watch. */
export async function POST(request: Request) {
  return withMutation(request, async (session) => {
    if (session.kind !== SessionKind.bearer || !session.deviceId || session.parentSessionId) {
      return jsonError(403, "paired_phone_required", "Set up the Watch from a paired iPhone.");
    }
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "A Watch identifier is required.");
    const issued = await createWatchSession(session, parsed.data.watchId);
    return Response.json({
      sessionId: issued.sessionId,
      token: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
    }, { status: 201 });
  });
}
