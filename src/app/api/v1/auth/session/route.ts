import { jsonCaughtError } from "@/server/http";
import { requireSession, toPublicSession } from "@/server/auth";

export async function GET(request: Request) {
  try {
    const { session, error } = await requireSession(request);
    if (error || !session) return error!;
    return Response.json({ session: toPublicSession(session) });
  } catch (error) {
    return jsonCaughtError(error);
  }
}
