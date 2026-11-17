import { z } from "zod";
import { TUNNEL_HEADER } from "@/lib/constants";
import { requestOrigin } from "@/server/auth";
import { readBody, readJson, withAdmin, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { clientTypeFrom, type ClientScope } from "@/lib/client-type";
import { claimCompanion, companionHost, inviteDevice, type CompanionClient, type InviteInput } from "@/server/pairing";

const Name = z.string().trim().min(1).max(80);
const AppInvite = { displayName: Name, endpointId: z.string().min(1), accountId: z.string().min(1).optional(), replacesDeviceId: z.string().min(1).optional() };
const AgentInvite = { displayName: Name, scope: z.enum(["full", "readOnly", "agent:full", "agent:readOnly"]) };
// A request names its client type with `clientType`, or, as installed apps do, with the older `client`
// words: `phone` is what apps built before 1.1.0 send for `app`. Strict, so a `scope` on an app's
// invite is refused rather than dropped: an invite always pairs the whole app.
const Invite = z.union([
  z.object({ clientType: z.literal("app"), client: z.enum(["app", "phone"]).optional(), ...AppInvite }).strict(),
  z.object({ client: z.enum(["app", "phone"]), ...AppInvite }).strict(),
  z.object({ clientType: z.literal("agent"), client: z.literal("agent").optional(), ...AgentInvite }),
  z.object({ client: z.literal("agent"), clientType: z.undefined().optional(), ...AgentInvite }),
]);
const Companion = z.union([
  z
    .object({ clientType: z.enum(["app-watch", "app-controls"]), client: z.enum(["watch", "app"]).optional(), scope: z.enum(["rulesOnly", "app:rulesOnly"]).optional(), clientId: z.string().uuid(), displayName: Name.optional() })
    // The older words, when sent too, must name the same client type.
    .refine((body) => !body.client || clientTypeFrom(body.client, body.client === "app" ? "rulesOnly" : null) === body.clientType),
  z.object({ client: z.literal("watch"), clientType: z.undefined().optional(), clientId: z.string().uuid(), displayName: Name.optional() }),
  z.object({ client: z.literal("app"), clientType: z.undefined().optional(), scope: z.literal("rulesOnly"), clientId: z.string().uuid(), displayName: Name.optional() }),
]);

/** An invite in the server's terms: its client type, and an agent's full scope. */
function inviteInput(body: z.infer<typeof Invite>): InviteInput {
  if ("scope" in body) return { clientType: "agent", displayName: body.displayName, scope: body.scope.startsWith("agent:") ? (body.scope as ClientScope) : (`agent:${body.scope}` as ClientScope) };
  const { displayName, endpointId, accountId, replacesDeviceId } = body;
  return { clientType: "app", displayName, endpointId, accountId, replacesDeviceId };
}

/** A companion in the server's terms: `client: watch` is `app-watch`, and `client: app` with `rulesOnly` is `app-controls`. */
function companionInput(body: z.infer<typeof Companion>) {
  const clientType = body.clientType ?? clientTypeFrom(body.client!, "scope" in body ? body.scope : null);
  return { clientType: clientType as CompanionClient, clientId: body.clientId, displayName: body.displayName };
}

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
        return jsonError(400, "invalid_request", "A Watch, or an app's rulesOnly sign-in, is invited by its paired phone with ?claim=true.");
      }
      return jsonError(400, "invalid_request", "A phone needs its name and route; an agent its name and scope (full or readOnly).");
    }
    const from = { tunnelled: request.headers.get(TUNNEL_HEADER) === "tunnel", origin: requestOrigin(request) };
    return Response.json(await inviteDevice(session, inviteInput(parsed.data), from), { status: 201 });
  });
}

async function claimCompanionRequest(request: Request) {
  return withMutation(request, async (session) => {
    const host = companionHost(session);
    const parsed = await readBody(request, Companion, "An identifier and optional name are required; only a Watch, or an app with the rulesOnly scope, is claimed this way.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await claimCompanion(host, companionInput(parsed.data), request.headers.get("user-agent")), { status: 201 });
  });
}

/** Whether a body names a Watch or an app's Siri and shortcuts, which only `?claim=true` sets up. */
function isCompanionRequest(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const body = value as { client?: unknown; clientType?: unknown; scope?: unknown };
  return body.clientType === "app-watch" || body.clientType === "app-controls" || body.client === "watch" || body.scope === "rulesOnly" || body.scope === "app:rulesOnly";
}
