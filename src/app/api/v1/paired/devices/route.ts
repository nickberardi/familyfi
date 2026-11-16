import { removeRevokedDevices } from "@/server/connection";
import { withAdmin, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { listPairedDevices } from "@/server/paired-devices";

/** Paired devices the caller may see: `?client=` (repeatable) and `?status=active|revoked` narrow it. */
export async function GET(request: Request) {
  return withSession(request, async (session) => {
    const params = new URL(request.url).searchParams;
    const devices = await listPairedDevices(session, { client: params.getAll("client"), status: params.get("status") ?? undefined });
    return Response.json({ devices });
  });
}

/** `?status=revoked` deletes every revoked device record. Active devices are never touched. */
export async function DELETE(request: Request) {
  return withAdmin(request, async () => {
    if (new URL(request.url).searchParams.get("status") !== "revoked") {
      return jsonError(400, "invalid_request", "Only revoked devices can be removed in bulk: add ?status=revoked.");
    }
    return Response.json({ removed: await removeRevokedDevices() });
  });
}
