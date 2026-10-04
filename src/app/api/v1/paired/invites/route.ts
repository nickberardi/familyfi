import { AccountKind, PairedDeviceClient, SessionKind } from "@prisma/client";
import { z } from "zod";
import { TUNNEL_HEADER } from "@/lib/constants";
import { requestOrigin } from "@/server/auth";
import { prisma } from "@/server/db";
import { readJson, withAdmin, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { inviteAgent, inviteAndClaimWatch, invitePhone } from "@/server/pairing";

const Name = z.string().trim().min(1).max(80);
const Invite = z.discriminatedUnion("client", [
  z.object({ client: z.literal("phone"), displayName: Name, endpointId: z.string().min(1), accountId: z.string().min(1).optional(), replacesDeviceId: z.string().min(1).optional() }),
  z.object({ client: z.literal("agent"), displayName: Name, scope: z.enum(["full", "readOnly"]) }),
]);
const Watch = z.object({ client: z.literal("watch"), clientId: z.string().uuid(), displayName: Name.optional() });

function inviteBody(invite: { id: string; expiresAt: Date }, code: string) {
  return { invite: { id: invite.id, expiresAt: invite.expiresAt.toISOString(), code } };
}

/**
 * Invite a device to join. An administrator invites a phone or an agent and gets a single-use code.
 * With `?claim=true`, a signed-in paired phone invites its Watch and claims it at once.
 */
export async function POST(request: Request) {
  if (new URL(request.url).searchParams.get("claim") === "true") return claimCompanion(request);
  return withAdmin(request, async (session) => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Invite.safeParse(body.value);
    if (!parsed.success) {
      if (body.value && typeof body.value === "object" && "client" in body.value && body.value.client === "watch") {
        return jsonError(400, "invalid_request", "A Watch is invited by its paired phone with ?claim=true.");
      }
      return jsonError(400, "invalid_request", "A phone needs its name and route; an agent its name and scope (full or readOnly).");
    }
    if (!session.accountId) return jsonError(403, "administrator_required", "Sign in with an account to invite a device.");
    const input = parsed.data;
    if (input.client === PairedDeviceClient.agent) {
      // The code carries the address it was made at, so it must be one an agent at home can reach.
      if (request.headers.get(TUNNEL_HEADER) === "tunnel") return jsonError(403, "agent_remote", "Connect an agent from the FamilyFi web app on the home network.");
      const { invite, code } = await inviteAgent({ url: requestOrigin(request), displayName: input.displayName, scope: input.scope, createdByAccountId: session.accountId });
      return Response.json(inviteBody(invite, code), { status: 201 });
    }
    const endpoint = await prisma().connectionEndpoint.findFirst({ where: { id: input.endpointId, householdId: "default", enabled: true } });
    if (!endpoint) return jsonError(404, "not_found", "Connection endpoint not found.");
    const accountId = input.accountId ?? session.accountId;
    const account = await prisma().account.findUnique({ where: { id: accountId } });
    if (!account) return jsonError(404, "not_found", "The account to sign the phone in as no longer exists.");
    // Only administrators have paired phones: a phone controls the household and its agents.
    if (account.kind !== AccountKind.recovery && !account.isAdmin) {
      return jsonError(400, "administrator_account_required", "A phone signs in only as an administrator.");
    }
    // Only a phone is re-paired as a phone: a Watch or agent is never replaced, and so never removed, this way.
    if (input.replacesDeviceId && (await prisma().pairedDevice.findUnique({ where: { id: input.replacesDeviceId } }))?.client !== PairedDeviceClient.phone) {
      return jsonError(404, "not_found", "The phone to re-pair no longer exists.");
    }
    const { invite, code } = await invitePhone({ endpointId: endpoint.id, displayName: input.displayName, accountId, createdByAccountId: session.accountId, replacesDeviceId: input.replacesDeviceId });
    return Response.json(inviteBody(invite, code), { status: 201 });
  });
}

/** Only a signed-in paired phone, and only for its Watch: no browser ever receives another device's tokens. */
async function claimCompanion(request: Request) {
  return withMutation(request, async (session) => {
    if (session.kind !== SessionKind.bearer || session.device?.client !== PairedDeviceClient.phone || !session.account) {
      return jsonError(403, "paired_phone_required", "Only a signed-in paired phone can invite and claim its Watch.");
    }
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Watch.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "A Watch identifier and optional name are required; only a Watch is claimed this way.");
    const { invite, claim } = await inviteAndClaimWatch({
      parentDeviceId: session.device.id,
      account: session.account,
      clientId: parsed.data.clientId,
      displayName: parsed.data.displayName ?? "Apple Watch",
      userAgent: request.headers.get("user-agent"),
    });
    return Response.json({ invite: { id: invite.id, expiresAt: invite.expiresAt.toISOString(), status: "claimed" }, ...claim }, { status: 201 });
  });
}
