import { z } from "zod";
import { TUNNEL_HEADER } from "@/lib/constants";
import { requestOrigin } from "@/server/auth";
import { readBody, readJson, withAdmin, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { claimCompanion, companionHost, inviteDevice } from "@/server/pairing";

const Name = z.string().trim().min(1).max(80);
// Strict, so a `scope` on an app's invite is refused rather than dropped: an invite always pairs the whole app.
const Invite = z.discriminatedUnion("clientType", [
  z.object({ clientType: z.literal("app"), displayName: Name, endpointId: z.string().min(1), accountId: z.string().min(1).optional(), replacesDeviceId: z.string().min(1).optional() }).strict(),
  z.object({ clientType: z.literal("agent"), displayName: Name, scope: z.enum(["agent:full", "agent:readOnly"]) }).strict(),
]);
const Companion = z.object({ clientType: z.enum(["app-watch", "app-controls"]), clientId: z.string().uuid(), displayName: Name.optional() }).strict();

/**
 * Invite a device to join. An administrator invites a phone or an agent and gets a single-use code.
 * With `?claim=true`, a signed-in paired app invites its Watch, or its own `rulesOnly` sign-in, and claims it at once.
 */
export async function POST(request: Request) {
  if (new URL(request.url).searchParams.get("claim") === "true") return claimCompanionRequest(request);
  return withAdmin(request, async (session) => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Invite.safeParse(body.value);
    if (!parsed.success) {
      if (isCompanionRequest(body.value)) {
        return jsonError(400, "invalid_request", "A Watch (app-watch) or an app's Siri and shortcuts (app-controls) is set up by its paired app with ?claim=true.");
      }
      return jsonError(400, "invalid_request", "An app (clientType app) needs its name and route; an agent (clientType agent) its name and scope (agent:full or agent:readOnly).");
    }
    const from = { tunnelled: request.headers.get(TUNNEL_HEADER) === "tunnel", origin: requestOrigin(request) };
    return Response.json(await inviteDevice(session, parsed.data, from), { status: 201 });
  });
}

async function claimCompanionRequest(request: Request) {
  return withMutation(request, async (session) => {
    const host = companionHost(session);
    const parsed = await readBody(request, Companion, "A clientType of app-watch or app-controls, an identifier and an optional name are required.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await claimCompanion(host, parsed.data, request.headers.get("user-agent")), { status: 201 });
  });
}

/** Whether a body names a Watch or an app's Siri and shortcuts, which only `?claim=true` sets up. */
function isCompanionRequest(value: unknown): boolean {
  const clientType = value && typeof value === "object" ? (value as { clientType?: unknown }).clientType : undefined;
  return clientType === "app-watch" || clientType === "app-controls";
}
