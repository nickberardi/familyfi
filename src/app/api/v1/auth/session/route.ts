import { requireSession, toPublicSession } from "@/server/auth";

export async function GET(request: Request) {
  const { session, error } = await requireSession(request);
  if (error || !session) return error!;
  return Response.json({ session: toPublicSession(session) });
}
