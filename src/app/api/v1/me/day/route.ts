import { withSession } from "@/server/guard";
import { childDay } from "@/server/child-day";
import { ApiError } from "@/server/http";

/** A child's own day, for FamilyFi Me on the child's phone. Only a child's phone (`me:askOnly`) has one. */
export async function GET(request: Request) {
  return withSession(request, async (session) => {
    if (session.device?.clientType !== "me") throw new ApiError(403, "me_required", "Only FamilyFi Me on a child's phone has a day to read.");
    return Response.json(await childDay(session.device.groupId));
  });
}
