import { prisma } from "./db";
import { randomToken } from "./crypto";
import { env } from "./env";

const INTERVAL_MS = 30_000;
const LOCK_MS = 25_000;

async function acquireLock(owner: string): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_MS);
  const existing = await prisma().reconciliationLock.findUnique({ where: { id: "global" } });
  if (!existing) {
    try {
      await prisma().reconciliationLock.create({ data: { id: "global", owner, expiresAt } });
      return true;
    } catch {
      return false;
    }
  }
  if (existing.owner !== owner && existing.expiresAt > now) return false;
  const updated = await prisma().reconciliationLock.updateMany({
    where: { id: "global", OR: [{ owner }, { expiresAt: { lte: now } }] },
    data: { owner, expiresAt },
  });
  return updated.count === 1;
}

async function tick(owner: string) {
  if (!(await acquireLock(owner))) return;
  const household = await prisma().household.findUnique({ where: { id: "default" } });
  if (!household || household.connectionStatus === "unconfigured") return;
}

export function startReconciliation() {
  env();
  const owner = `${process.pid}:${randomToken(8)}`;
  void tick(owner).catch(() => undefined);
  const timer = setInterval(() => {
    void tick(owner).catch(() => undefined);
  }, INTERVAL_MS);
  timer.unref?.();
}
