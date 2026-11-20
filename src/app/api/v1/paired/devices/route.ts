import { removeRevokedDevices } from "@/server/connection";
import { withAdmin, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { listPairedDevices } from "@/server/paired-devices";

/**
 * The client types each value of the `?client=` filter apps before 2.0 send stands for. Their `app`
 * covered the app's Siri sign-in too, which was an `app` with `rulesOnly`; `phone` is `app` from before 1.1.
 */
const LEGACY_CLIENT: Record<string, string[]> = { app: ["app", "app-controls"], phone: ["app", "app-controls"], watch: ["app-watch"], agent: ["agent"] };

/**
 * Paired devices the caller may see: `?clientType=` (repeatable) and `?status=active|revoked` narrow it.
 * `?client=`, deprecated, is still read for apps before 2.0, so their Watch screen lists only Watches.
 */
export async function GET(request: Request) {
  return withSession(request, async (session) => {
    const params = new URL(request.url).searchParams;
    const legacy = params.getAll("client").flatMap((client) => LEGACY_CLIENT[client] ?? [client]);
    const devices = await listPairedDevices(session, { clientType: [...params.getAll("clientType"), ...legacy], status: params.get("status") ?? undefined });
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
