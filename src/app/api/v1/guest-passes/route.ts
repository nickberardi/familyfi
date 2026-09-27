import { z } from "zod";
import { readJson, withMutation } from "@/server/guard";
import { guestResponseError } from "@/server/guest-http";
import { createGuestPass } from "@/server/guests";
import { jsonError } from "@/server/http";

const Body = z.object({ clientId: z.string().min(1), timeLimitMinutes: z.number().int().min(1).max(1440) }).strict();

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Provide a clientId and duration from 1 to 1440 minutes.");
    try { return Response.json({ pass: await createGuestPass(parsed.data.clientId, parsed.data.timeLimitMinutes) }, { status: 201 }); }
    catch (error) { return guestResponseError(error); }
  });
}
