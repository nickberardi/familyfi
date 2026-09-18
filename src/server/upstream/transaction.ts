import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

/** Serialize short upstream writes across processes. Never hold this during DNS I/O. */
export function withUpstreamLock<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = 'default' FOR UPDATE`;
    return work(tx);
  });
}
