import { NextResponse } from "next/server";
import { z } from "zod";
import { PairedDeviceClient, SessionKind } from "@prisma/client";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  authenticate,
  createSession,
  csrfCookieOptions,
  originAllowed,
  requestIsHttps,
  sessionCookieOptions,
  toPublicSession,
} from "@/server/auth";
import { clientIp, jsonCaughtError, jsonError } from "@/server/http";
import { authenticatePairedDevice, claimAgentPairing } from "@/server/connection";
import { prisma } from "@/server/db";
import { TUNNEL_HEADER } from "@/lib/constants";

/**
 * An agent never sends a password. The first call claims its pairing (`pairing` is the code's
 * `pairingId.token`); every later call renews with the device credential that claim returned.
 */
const AgentBody = z.union([
  z.object({ client: z.literal("agent"), pairing: z.string().regex(/^[^.]+\.[^.]+$/), deviceName: z.string().trim().min(1).max(80).optional() }),
  z.object({ client: z.literal("agent"), deviceId: z.string().min(1), deviceCredential: z.string().min(1) }),
]);

const Body = z.object({
  username: z.string(),
  password: z.string(),
  client: z.enum(["browser", "native"]).optional(),
  deviceId: z.string().min(1).optional(),
  deviceCredential: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  if (!originAllowed(request)) {
    return jsonError(403, "forbidden_origin", "Request origin is not allowed.");
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON.");
  }
  if (json && typeof json === "object" && "client" in json && json.client === "agent") return agentLogin(request, json);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return jsonError(400, "invalid_request", "Username and password are required.");
  }

  try {
    const native = parsed.data.client === "native";
    const tunnelled = request.headers.get(TUNNEL_HEADER) === "tunnel";
    // Through remote access only a paired phone may sign in, and the phone is checked
    // before the password, so the internet cannot test passwords without one.
    if (tunnelled && !native) return jsonError(403, "remote_browser_login", "Sign in to the FamilyFi web app from the home network.");
    let device = tunnelled ? await pairedDevice(parsed.data) : null;
    if (tunnelled && !device) return jsonError(403, "device_not_paired", "Pair this phone with a household administrator before signing in.");

    const result = await authenticate(parsed.data.username, parsed.data.password, clientIp(request));
    if (!result.ok) return jsonError(result.status, result.code, result.message);

    if (native && !device) device = await pairedDevice(parsed.data);
    if (native && !device) return jsonError(403, "device_not_paired", "Pair this phone with a household administrator before signing in.");
    const issued = await createSession({
      accountId: result.account.id,
      username: result.account.username,
      kind: native ? SessionKind.bearer : SessionKind.cookie,
      userAgent: request.headers.get("user-agent"),
      deviceId: device?.id,
    });

    const body = {
      session: toPublicSession({
        username: result.account.username,
        expiresAt: issued.expiresAt,
        account: result.account,
      }),
      ...(native ? { token: issued.raw, tokenType: "Bearer" as const, refreshToken: issued.refresh, refreshExpiresAt: issued.refreshExpiresAt?.toISOString() } : {}),
    };

    const response = NextResponse.json(body);
    if (!native) {
      const maxAge = Math.floor((issued.expiresAt.getTime() - Date.now()) / 1000);
      const secure = requestIsHttps(request);
      response.cookies.set(SESSION_COOKIE, issued.raw, sessionCookieOptions(maxAge, secure));
      response.cookies.set(CSRF_COOKIE, issued.csrf, csrfCookieOptions(maxAge, secure));
    }
    return response;
  } catch (error) {
    return jsonCaughtError(error);
  }
}

/** A phone or Watch; an agent's credential signs in only as an agent. */
async function pairedDevice(body: { deviceId?: string; deviceCredential?: string }) {
  const device = body.deviceId && body.deviceCredential ? await authenticatePairedDevice(body.deviceId, body.deviceCredential) : null;
  return device?.client === PairedDeviceClient.agent ? null : device;
}

async function agentLogin(request: Request, json: unknown) {
  const parsed = AgentBody.safeParse(json);
  if (!parsed.success) return jsonError(400, "invalid_request", "An agent sends its pairing, or its device ID and credential.");
  if (request.headers.get(TUNNEL_HEADER) === "tunnel") return jsonError(403, "agent_remote", "Agents connect from the home network only.");
  try {
    const body = parsed.data;
    if ("pairing" in body) {
      const [id, token] = body.pairing.split(".");
      const claimed = await claimAgentPairing({ id, token, displayName: body.deviceName, userAgent: request.headers.get("user-agent") });
      if (!claimed) return jsonError(403, "invalid_pairing", "Pairing code is invalid, expired, or already used.");
      return NextResponse.json({
        session: toPublicSession({ username: claimed.account.username, expiresAt: claimed.expiresAt, account: claimed.account }),
        token: claimed.token,
        tokenType: "Bearer" as const,
        device: { id: claimed.device.id, displayName: claimed.device.displayName, grant: claimed.device.agentGrant },
        deviceCredential: claimed.credential,
      });
    }
    const device = await authenticatePairedDevice(body.deviceId, body.deviceCredential);
    const account = device?.client === PairedDeviceClient.agent && device.accountId ? await prisma().account.findUnique({ where: { id: device.accountId } }) : null;
    if (!device || !account) return jsonError(403, "device_not_paired", "This agent is not paired, or was disconnected. Ask for a new pairing code.");
    const issued = await createSession({ accountId: account.id, username: account.username, kind: SessionKind.bearer, userAgent: request.headers.get("user-agent"), deviceId: device.id });
    return NextResponse.json({
      session: toPublicSession({ username: account.username, expiresAt: issued.expiresAt, account }),
      token: issued.raw,
      tokenType: "Bearer" as const,
      device: { id: device.id, displayName: device.displayName, grant: device.agentGrant },
    });
  } catch (error) {
    return jsonCaughtError(error);
  }
}
