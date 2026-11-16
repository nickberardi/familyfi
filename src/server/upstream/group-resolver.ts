import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { groupInclude, publicGroup } from "../groups";
import { ApiError } from "../http";
import { refreshResolverContexts } from "./discovery";
import { ResolverConfigError, normalizeResolverUrl } from "./resolver-settings";
import { withUpstreamLock } from "./transaction";

/**
 * A group's own DNS-over-HTTPS endpoint — "Own endpoint" in the web's Edit sheet, "Override for this group" in the app.
 *
 * Reporting only, like everything upstream: this changes which resolver FamilyFi
 * *asks about* this group, never what reaches its devices. Pointing the devices
 * themselves at that resolver is a DHCP or client-side job, outside this app.
 *
 * No `enqueueChange`: nothing here reaches UniFi.
 */

async function requireGroup(id: string) {
  const group = await prisma().group.findUnique({ where: { id }, select: { id: true } });
  if (!group) throw new ApiError(404, "not_found", "Group not found.");
}

async function householdTimezone() {
  const household = await prisma().household.findUnique({ where: { id: "default" }, select: { timezone: true } });
  return household?.timezone ?? "UTC";
}

export async function getGroupResolver(id: string) {
  await requireGroup(id);
  const contexts = await refreshResolverContexts();
  const context = contexts.groups.get(id)!;
  return {
    configured: context.source !== "unknown" && !context.reason,
    source: context.source,
    url: context.url,
    networks: context.networks,
    reason: context.reason,
  };
}

export async function setGroupResolver(id: string, rawUrl: string) {
  let url: string;
  try {
    url = normalizeResolverUrl(rawUrl);
  } catch (error) {
    if (error instanceof ResolverConfigError) throw new ApiError(400, "invalid_resolver", error.message);
    throw error;
  }
  await requireGroup(id);
  const timezone = await householdTimezone();
  const group = await withUpstreamLock(async (tx) => {
    const current = await tx.group.findUniqueOrThrow({ where: { id } });
    if (current.dohOverrideUrl !== url) {
      await tx.upstreamCheck.deleteMany({ where: { groupId: id } });
    }
    return tx.group.update({
      where: { id },
      include: groupInclude,
      data: { dohOverrideUrl: url, ...(current.dohOverrideUrl !== url ? { upstreamResolverSnapshot: Prisma.DbNull } : {}) },
    });
  });
  await refreshResolverContexts();
  return publicGroup(group, timezone);
}

/**
 * Back to the household default. The group's own verdicts are dropped with it — they
 * describe an endpoint this group no longer uses, and keeping them would report a
 * stale answer on its card until the next sweep.
 */
export async function clearGroupResolver(id: string) {
  await requireGroup(id);
  const timezone = await householdTimezone();
  const group = await withUpstreamLock(async (tx) => {
    await tx.upstreamCheck.deleteMany({ where: { groupId: id } });
    return tx.group.update({ where: { id }, include: groupInclude, data: { dohOverrideUrl: null, upstreamResolverSnapshot: Prisma.DbNull } });
  });
  await refreshResolverContexts();
  return publicGroup(group, timezone);
}
