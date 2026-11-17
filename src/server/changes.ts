import { ChangeStatus } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "./db";
import { ApiError } from "./http";

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

/** Who asked for a change: the adult, and the paired device they used, when they did not sign in on the web. */
export type ChangeActorView = { displayName: string; device?: { displayName: string } };

/** Whether a reader is told who asked for each change: everyone but an agent, which never reaches the household's adults. */
export function readsChangeActors(session: { device?: { clientType: string } | null }): boolean {
  return session.device?.clientType !== "agent";
}

/** What a change row needs loaded to say who asked for it. */
export const CHANGE_ACTOR_INCLUDE = {
  actorAccount: { select: { displayName: true } },
  actorDevice: { select: { displayName: true } },
} as const;

type ActorRows = {
  actorAccount?: { displayName: string } | null;
  actorDevice?: { displayName: string } | null;
};

/**
 * Who asked, when the adult is still on record and `withActor` is set. An account removed since
 * leaves `actor` out, and so does a reader that may not see the household's adults (an agent).
 */
function actorView(change: ActorRows, withActor: boolean): ChangeActorView | undefined {
  if (!withActor || !change.actorAccount) return undefined;
  return {
    displayName: change.actorAccount.displayName,
    ...(change.actorDevice ? { device: { displayName: change.actorDevice.displayName } } : {}),
  };
}

export function publicChange(change: ActorRows & {
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
}, withActor = false) {
  const actor = actorView(change, withActor);
  return {
    id: change.id,
    revision: change.requestedRevision,
    appliedRevision: change.appliedRevision,
    status: change.status,
    scope: change.scope,
    deviceMac: change.deviceMac,
    actorAccountId: change.actorAccountId,
    actorDeviceId: change.actorDeviceId,
    ...(actor ? { actor } : {}),
    error: change.error,
    updatedAt: change.updatedAt.toISOString(),
  };
}

export async function getChange(id: string, { withActor = false }: { withActor?: boolean } = {}) {
  const change = await prisma().changeResult.findUnique({ where: { id }, include: CHANGE_ACTOR_INCLUDE });
  if (!change) throw new ApiError(404, "not_found", "Change not found.");
  return publicChange(change, withActor);
}
