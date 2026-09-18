import { z } from "zod";
import { prisma } from "@/server/db";
import { publicGroup } from "@/server/groups";
import { readJson, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { ResolverConfigError, normalizeResolverUrl } from "@/server/upstream/resolver-settings";
import { withUpstreamLock } from "@/server/upstream/transaction";

type Ctx = { params: Promise<{ id: string }> };

/**
 * A group's own DNS-over-HTTPS endpoint — the design's "Override for this member".
 *
 * Reporting only, like everything upstream: this changes which resolver FamilyFi
 * *asks about* this group, never what reaches its devices. Pointing the devices
 * themselves at that resolver is a DHCP or client-side job, outside this app.
 *
 * No `enqueueChange`: nothing here reaches UniFi.
 */
const Body = z.object({ url: z.string().min(1) });

export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Paste the endpoint URL.");

    let url: string;
    try {
      url = normalizeResolverUrl(parsed.data.url);
    } catch (error) {
      if (error instanceof ResolverConfigError) {
        return jsonError(400, "invalid_resolver", error.message);
      }
      throw error;
    }

    const existing = await prisma().group.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return jsonError(404, "not_found", "Group not found.");

    const household = await prisma().household.findUnique({
      where: { id: "default" },
      select: { timezone: true },
    });
    const group = await withUpstreamLock(async (tx) => {
      const current = await tx.group.findUniqueOrThrow({ where: { id } });
      if (current.dohOverrideUrl !== url) {
        await tx.upstreamCheck.deleteMany({ where: { groupId: id } });
      }
      return tx.group.update({ where: { id }, data: { dohOverrideUrl: url } });
    });
    return Response.json({ group: publicGroup(group, household?.timezone ?? "UTC") });
  });
}

/**
 * Back to the household default. The group's own verdicts are dropped with it — they
 * describe an endpoint this group no longer uses, and keeping them would report a
 * stale answer on its card until the next sweep.
 */
export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const existing = await prisma().group.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return jsonError(404, "not_found", "Group not found.");

    const household = await prisma().household.findUnique({
      where: { id: "default" },
      select: { timezone: true },
    });
    const group = await withUpstreamLock(async (tx) => {
      await tx.upstreamCheck.deleteMany({ where: { groupId: id } });
      return tx.group.update({ where: { id }, data: { dohOverrideUrl: null } });
    });
    return Response.json({ group: publicGroup(group, household?.timezone ?? "UTC") });
  });
}
