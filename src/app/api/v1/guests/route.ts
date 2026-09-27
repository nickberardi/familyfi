import { withSession } from "@/server/guard";
import { guestResponseError } from "@/server/guest-http";
import { listGuests } from "@/server/guests";

export async function GET(request: Request) {
  return withSession(request, async () => {
    try { return Response.json(await listGuests()); }
    catch (error) { return guestResponseError(error); }
  });
}
