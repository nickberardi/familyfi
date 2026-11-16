import { prisma } from "@/server/db";

/**
 * The recovery administrator as a browser session, for a `src/server` function that takes the
 * caller: who a pause or allowance is recorded against, and no paired device to bound it.
 */
export async function adminSession() {
  const account = await prisma().account.findUniqueOrThrow({ where: { username: "admin" } });
  return { accountId: account.id, username: account.username, account, device: null, deviceId: null };
}
