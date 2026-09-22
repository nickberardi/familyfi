import { ensureConnectionIdentity, instanceFingerprint } from "@/server/connection";

export async function GET() {
  const household = await ensureConnectionIdentity();
  return Response.json({
    protocolVersion: 1,
    householdName: household.displayName,
    instanceId: household.instanceId,
    publicKey: JSON.parse(household.instancePublicKey!),
    keyFingerprint: instanceFingerprint(household.instancePublicKey!),
  });
}
