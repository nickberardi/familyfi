import { requireSession, toPublicSession } from "@/server/auth";
import { sessionHousehold } from "@/server/household";
import { jsonCaughtError } from "@/server/http";

export async function GET(request: Request) {
  try {
    const { session, error } = await requireSession(request);
    if (error || !session) return error!;
    return Response.json({ session: toPublicSession(session), ...(await sessionHousehold()) });
  } catch (error) {
    return jsonCaughtError(error);
  }
}
