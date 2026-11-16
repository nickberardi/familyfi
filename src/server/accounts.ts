import { AccountKind, FamilyRole, GroupKind } from "@prisma/client";
import { RECOVERY_USERNAME } from "@/lib/constants";
import { hashPassword, revokeAccountSessions } from "./auth";
import { enqueueChange } from "./changes";
import { removeAccountDevices } from "./connection";
import { prisma } from "./db";
import { ApiError } from "./http";

export function publicAccount(account: {
  id: string;
  username: string;
  displayName: string;
  kind: AccountKind;
  isAdmin: boolean;
  groupId: string | null;
}) {
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    kind: account.kind === AccountKind.recovery ? "recovery" : "personal",
    isAdmin: account.isAdmin,
    groupId: account.groupId,
    recovery: account.kind === AccountKind.recovery,
  };
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function assertPersonalUsername(username: string) {
  if (!username || username.length < 2) {
    throw new Error("Username must be at least 2 characters.");
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error("Username may only contain letters, digits, dots, underscores, and hyphens.");
  }
  if (username === RECOVERY_USERNAME) {
    throw new Error("Username admin is reserved for recovery.");
  }
}

export function assertAdultFamilyGroup(group: { kind: GroupKind; familyRole: FamilyRole | null } | null) {
  if (!group) throw new Error("Adult accounts must belong to a Family group.");
  if (group.kind !== GroupKind.family || group.familyRole !== FamilyRole.adult) {
    throw new Error("Only adult Family members can have accounts. Children, teens, and Things cannot log in.");
  }
}

function accountNotFound() {
  return new ApiError(404, "not_found", "Account not found.");
}

/** Refuses a group no account can belong to. */
function requireAdultFamilyGroup(group: Parameters<typeof assertAdultFamilyGroup>[0]) {
  try {
    assertAdultFamilyGroup(group);
  } catch (error) {
    throw new ApiError(400, "invalid_group", error instanceof Error ? error.message : "Invalid group.");
  }
}

export async function listAccounts() {
  const accounts = await prisma().account.findMany({ orderBy: { createdAt: "asc" } });
  return accounts.map(publicAccount);
}

export async function getAccount(id: string) {
  const account = await prisma().account.findUnique({ where: { id } });
  if (!account) throw accountNotFound();
  return publicAccount(account);
}

export async function createAccount(input: { username: string; displayName: string; password: string; groupId: string; isAdmin?: boolean }) {
  const username = normalizeUsername(input.username);
  try {
    assertPersonalUsername(username);
  } catch (error) {
    throw new ApiError(400, "invalid_username", error instanceof Error ? error.message : "Invalid username.");
  }
  requireAdultFamilyGroup(await prisma().group.findUnique({ where: { id: input.groupId } }));
  const existing = await prisma().account.findUnique({ where: { username } });
  if (existing) throw new ApiError(409, "username_taken", "That username is already in use.");
  const account = await prisma().account.create({
    data: {
      username,
      displayName: input.displayName,
      kind: AccountKind.personal,
      isAdmin: input.isAdmin ?? true,
      groupId: input.groupId,
      passwordHash: await hashPassword(input.password),
    },
  });
  const change = await enqueueChange("account");
  return { account: publicAccount(account), change };
}

export async function updateAccount(id: string, input: { displayName?: string; groupId?: string; isAdmin?: boolean }) {
  const existing = await prisma().account.findUnique({ where: { id } });
  if (!existing) throw accountNotFound();
  if (existing.kind === AccountKind.recovery) {
    throw new ApiError(409, "recovery_account", "The recovery admin cannot be edited here.");
  }
  if (input.groupId) {
    requireAdultFamilyGroup(await prisma().group.findUnique({ where: { id: input.groupId } }));
  }
  // Only administrators use FamilyFi: losing it signs them out and unpairs and removes their devices, in one step.
  const demoted = existing.isAdmin && input.isAdmin === false;
  const account = await prisma().$transaction(async (db) => {
    const updated = await db.account.update({
      where: { id },
      data: { displayName: input.displayName, groupId: input.groupId, isAdmin: input.isAdmin },
    });
    if (demoted) {
      await removeAccountDevices(id, db as never);
      // Nor do they sign in: their browser sessions end too.
      await db.session.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return updated;
  });
  const change = await enqueueChange("account");
  return { account: publicAccount(account), change };
}

export async function deleteAccount(id: string) {
  const existing = await prisma().account.findUnique({ where: { id } });
  if (!existing) throw accountNotFound();
  if (existing.kind === AccountKind.recovery) {
    throw new ApiError(409, "recovery_account", "The recovery admin cannot be removed.");
  }
  await revokeAccountSessions(id);
  await prisma().account.delete({ where: { id } });
  return { change: await enqueueChange("account") };
}

/** A new password ends every session the account has. */
export async function setAccountPassword(id: string, password: string) {
  const existing = await prisma().account.findUnique({ where: { id } });
  if (!existing) throw accountNotFound();
  if (existing.kind === AccountKind.recovery) {
    throw new ApiError(409, "recovery_account", "Change FAMILYFI_DEFAULT_PASSWORD in .env for the recovery admin.");
  }
  const account = await prisma().account.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
  await revokeAccountSessions(id);
  const change = await enqueueChange("account");
  return { account: publicAccount(account), change };
}
