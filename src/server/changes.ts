import { ChangeStatus } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "./db";

type ChangeActor = { accountId: string | null; deviceId: string | null };
const changeActor = new AsyncLocalStorage<ChangeActor>();

/** Associates changes made during one authenticated mutation with its account and phone. */
export function withChangeActor<T>(actor: ChangeActor, work: () => Promise<T>): Promise<T> {
  return changeActor.run(actor, work);
}

export async function bumpRevision(): Promise<number> {
  const household = await prisma().household.update({
    where: { id: "default" },
    data: { revision: { increment: 1 } },
  });
  return household.revision;
}

export async function enqueueChange(scope: string, deviceMac?: string) {
  const actor = changeActor.getStore();
  const revision = await bumpRevision();
  const change = await prisma().changeResult.create({
    data: {
      requestedRevision: revision,
      status: ChangeStatus.pending,
      scope,
      deviceMac,
      actorAccountId: actor?.accountId ?? undefined,
      actorDeviceId: actor?.deviceId ?? undefined,
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
  actorAccountId: string | null;
  actorDeviceId: string | null;
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
    actorAccountId: change.actorAccountId,
    actorDeviceId: change.actorDeviceId,
    error: change.error,
    updatedAt: change.updatedAt.toISOString(),
  };
}
