import { ChangeStatus } from "@prisma/client";
import { prisma } from "./db";

export async function bumpRevision(): Promise<number> {
  const household = await prisma().household.update({
    where: { id: "default" },
    data: { revision: { increment: 1 } },
  });
  return household.revision;
}

export async function enqueueChange(scope: string, deviceMac?: string) {
  const revision = await bumpRevision();
  const change = await prisma().changeResult.create({
    data: {
      requestedRevision: revision,
      status: ChangeStatus.pending,
      scope,
      deviceMac,
    },
  });
  const { requestReconcile } = await import("./reconciliation");
  requestReconcile();
  return { changeId: change.id, revision };
}

export function publicChange(change: {
  id: string;
  requestedRevision: number;
  appliedRevision: number | null;
  status: ChangeStatus;
  scope: string;
  deviceMac: string | null;
  error: string | null;
  updatedAt: Date;
}) {
  return {
    id: change.id,
    revision: change.requestedRevision,
    appliedRevision: change.appliedRevision,
    status: change.status,
    scope: change.scope,
    deviceMac: change.deviceMac,
    error: change.error,
    updatedAt: change.updatedAt.toISOString(),
  };
}
