import { jsonCaughtError } from "@/server/http";
import { requireSession, toPublicSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { householdTimezone } from "@/lib/household-state";

export async function GET(request: Request) {
  try {
    const { session, error } = await requireSession(request);
    if (error || !session) return error!;
    // Every caller may read this, a Watch included, which may not read household settings.
    const household = await prisma().household.findUnique({ where: { id: "default" }, select: { timezone: true } });
    return Response.json({ session: toPublicSession(session), timezone: householdTimezone(household) });
  } catch (error) {
    return jsonCaughtError(error);
  }
}
