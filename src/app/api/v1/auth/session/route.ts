import { requireSession, toPublicSession } from "@/server/auth";
import { currentTimezone } from "@/server/household";
import { jsonCaughtError } from "@/server/http";

export async function GET(request: Request) {
  try {
    const { session, error } = await requireSession(request);
    if (error || !session) return error!;
    return Response.json({ session: toPublicSession(session), timezone: await currentTimezone() });
  } catch (error) {
    return jsonCaughtError(error);
  }
}
