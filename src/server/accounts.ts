import { AccountKind, FamilyRole, GroupKind } from "@prisma/client";
import { RECOVERY_USERNAME } from "@/lib/constants";

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
