import { enqueueChange } from "@/server/changes";
import { withMutation } from "@/server/guard";

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const change = await enqueueChange("retry");
    return Response.json({ change });
  });
}
