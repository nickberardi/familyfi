import { z } from "zod";
import { TUNNEL_HEADER } from "@/lib/constants";
import { requestOrigin } from "@/server/auth";
import { readBody, readJson, withAdmin, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { claimCompanion, companionHost, inviteDevice } from "@/server/pairing";

const Name = z.string().trim().min(1).max(80);
const Invite = z.discriminatedUnion("client", [
  // `phone` is what apps built before 1.1.0 send for `app`.
  // Strict, so a `scope` here is refused rather than dropped: an invite always pairs the whole app.
  z.object({ client: z.enum(["app", "phone"]), displayName: Name, endpointId: z.string().min(1), accountId: z.string().min(1).optional(), replacesDeviceId: z.string().min(1).optional() }).strict(),
  z.object({ client: z.literal("agent"), displayName: Name, scope: z.enum(["full", "readOnly"]) }),
]);
const Companion = z.discriminatedUnion("client", [
  z.object({ client: z.literal("watch"), clientId: z.string().uuid(), displayName: Name.optional() }),
  z.object({ client: z.literal("app"), scope: z.literal("rulesOnly"), clientId: z.string().uuid(), displayName: Name.optional() }),
]);

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
      if (body.value && typeof body.value === "object" && "client" in body.value && (body.value.client === "watch" || ("scope" in body.value && body.value.scope === "rulesOnly"))) {
        return jsonError(400, "invalid_request", "A Watch, or an app's rulesOnly sign-in, is invited by its paired phone with ?claim=true.");
      }
      return jsonError(400, "invalid_request", "A phone needs its name and route; an agent its name and scope (full or readOnly).");
    }
    const from = { tunnelled: request.headers.get(TUNNEL_HEADER) === "tunnel", origin: requestOrigin(request) };
    return Response.json(await inviteDevice(session, parsed.data, from), { status: 201 });
  });
}

async function claimCompanionRequest(request: Request) {
  return withMutation(request, async (session) => {
    const host = companionHost(session);
    const parsed = await readBody(request, Companion, "An identifier and optional name are required; only a Watch, or an app with the rulesOnly scope, is claimed this way.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await claimCompanion(host, parsed.data, request.headers.get("user-agent")), { status: 201 });
  });
}
