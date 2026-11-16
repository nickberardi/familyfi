import { publicIdentity } from "@/server/connection";

export async function GET() {
  return Response.json(await publicIdentity());
}
