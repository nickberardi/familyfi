import { z } from "zod";
import { watchGroupControlAllowed } from "@/server/auth";
import { enqueueChange } from "@/server/changes";
import { groupInclude, internetWindows, publicGroup, sessionActor } from "@/server/groups";
import { windowEndsAt } from "@/lib/rule-windows";
import { prisma } from "@/server/db";
import { withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";

const Body = z.object({
  until: z.string().datetime().nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

/**
 * Lets a group back online during its internet rules' windows, until `until`, by default
 * when the windows active now end. Category, app and website rules keep applying.
 */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    let value: unknown = {};
    try {
      value = await request.json();
    } catch {
      value = {};
    }
    const parsed = Body.safeParse(value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid allow request.");
    const existing = await prisma().group.findUnique({ where: { id }, include: groupInclude });
    if (!existing) return jsonError(404, "not_found", "Group not found.");
    if (!watchGroupControlAllowed(session, existing)) return jsonError(403, "watch_group_forbidden", "The Watch cannot control this group.");
    if (existing.protected) return jsonError(409, "protected", "Protected groups have no internet rules.");
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const now = new Date();
    const ends = internetWindows(existing)
      .map((window) => windowEndsAt(window, now, household.timezone))
      .filter((end): end is Date => end !== null)
      .sort((a, b) => b.getTime() - a.getTime());
    if (parsed.data.until === undefined && ends.length === 0) {
      return jsonError(409, "not_in_window", "No internet rule is blocking this group now.");
    }
    const until = parsed.data.until === undefined ? ends[0]! : parsed.data.until === null ? null : new Date(parsed.data.until);
    if (until && until.getTime() <= now.getTime()) return jsonError(400, "invalid_request", "until must be in the future.");
    const group = await prisma().group.update({
      where: { id },
      data: {
        allowActive: true,
        allowUntil: until,
        allowedByAccountId: sessionActor(session).accountId,
        allowedByName: sessionActor(session).name,
        suspensionActive: false,
        suspensionUntil: null,
        suspendedByAccountId: null,
        suspendedByName: null,
      },
      include: groupInclude,
    });
    const change = await enqueueChange("allow");
    return Response.json({ group: publicGroup(group, household.timezone, now), change });
  });
}

/** Ends an allowance: the group's internet rules apply again. */
export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const existing = await prisma().group.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Group not found.");
    if (!watchGroupControlAllowed(session, existing)) return jsonError(403, "watch_group_forbidden", "The Watch cannot control this group.");
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const group = await prisma().group.update({
      where: { id },
      data: { allowActive: false, allowUntil: null, allowedByAccountId: null, allowedByName: null },
      include: groupInclude,
    });
    const change = await enqueueChange("allow");
    return Response.json({ group: publicGroup(group, household.timezone), change });
  });
}
