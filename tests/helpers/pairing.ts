import { ConnectionTransport } from "@prisma/client";
import { expect } from "vitest";
import { POST as invite } from "@/app/api/v1/paired/invites/route";
import { POST as claimRoute } from "@/app/api/v1/paired/invites/[id]/claim/route";
import { prisma } from "@/server/db";
import type { PairingPayload } from "@/server/pairing-code";
import { request, type SessionAuth } from "./http";

/** What a device reads out of an invite code: the decoded payload, and the claim's invite id and token. */
export function decodePairingCode(code: string): { payload: PairingPayload; inviteId: string; token: string } {
  expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  const payload = JSON.parse(Buffer.from(code, "base64url").toString("utf8")) as PairingPayload;
  const dot = payload.code.indexOf(".");
  return { payload, inviteId: payload.code.slice(0, dot), token: payload.code.slice(dot + 1) };
}

/** A `POST /paired/invites` body, decoded the way the device would. */
export async function issuedInvite(response: Response) {
  const { invite } = (await response.json()) as { invite: { id: string; expiresAt: string; code: string } };
  const decoded = decodePairingCode(invite.code);
  expect(decoded.inviteId).toBe(invite.id);
  return { id: invite.id, code: invite.code, ...decoded };
}

/** What every claim answers. */
export type Claim = {
  device: { id: string; displayName: string; client: string; scope: string };
  session: { username: string; expiresAt: string };
  token: string;
  tokenType: "Bearer";
  refreshToken: string;
  refreshExpiresAt: string;
  connection?: { endpoint?: { id: string; url: string }; manifest: { instanceId: string; signedPayload: string; signature: string; endpoints: unknown[] } };
};

export function bearer(token: string): SessionAuth {
  return { cookie: "", csrf: "", token };
}

/** An enabled home route a phone can pair over, made directly: these tests are not about routes. */
export async function homeRoute(url = "https://familyfi.local") {
  return prisma().connectionEndpoint.upsert({ where: { url }, update: { enabled: true }, create: { url, transport: ConnectionTransport.lan } });
}

export function invitePhoneRequest(auth: SessionAuth, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return invite(request("/api/v1/paired/invites", { method: "POST", auth, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ client: "phone", displayName: "iPhone", ...body }) }));
}

export function claimInvite(issued: { inviteId: string; token: string }, deviceName = "iPhone", headers: Record<string, string> = {}) {
  return claimRoute(
    request(`/api/v1/paired/invites/${issued.inviteId}/claim`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ token: issued.token, deviceName }) }),
    { params: Promise.resolve({ id: issued.inviteId }) },
  );
}

/** A phone paired the way the app does it: an administrator invites it, and it claims the code. */
export async function pairPhone(admin: SessionAuth, options: { endpointId?: string; accountId?: string; displayName?: string } = {}): Promise<Claim> {
  const endpointId = options.endpointId ?? (await homeRoute()).id;
  const created = await invitePhoneRequest(admin, { endpointId, ...(options.accountId ? { accountId: options.accountId } : {}), displayName: options.displayName ?? "iPhone" });
  expect(created.status).toBe(201);
  const claimed = await claimInvite(await issuedInvite(created), options.displayName ?? "iPhone");
  expect(claimed.status).toBe(200);
  return (await claimed.json()) as Claim;
}

/** A phone invites its Watch and claims it in one call. */
export function claimWatchRequest(phone: SessionAuth, body: Record<string, unknown> = {}) {
  return invite(request("/api/v1/paired/invites?claim=true", { method: "POST", auth: phone, headers: { "content-type": "application/json" }, body: JSON.stringify({ client: "watch", clientId: "f626e8d1-57bc-4c88-9068-7c9ce6d4d0d1", ...body }) }));
}
