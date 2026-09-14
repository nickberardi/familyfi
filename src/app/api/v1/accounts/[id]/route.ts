import { AccountKind } from "@prisma/client";
import { z } from "zod";
import { assertAdultFamilyGroup, publicAccount } from "@/server/accounts";
import { enqueueChange } from "@/server/changes";
import { revokeAccountSessions } from "@/server/auth";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";

const Update = z.object({
  displayName: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  isAdmin: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { id } = await ctx.params;
    const account = await prisma().account.findUnique({ where: { id } });
    if (!account) return jsonError(404, "not_found", "Account not found.");
    return Response.json({ account: publicAccount(account) });
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Update.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid account update.");
    const existing = await prisma().account.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Account not found.");
    if (existing.kind === AccountKind.recovery) {
      return jsonError(409, "recovery_account", "The recovery admin cannot be edited here.");
    }
    if (parsed.data.groupId) {
      const group = await prisma().group.findUnique({ where: { id: parsed.data.groupId } });
      try {
        assertAdultFamilyGroup(group);
      } catch (error) {
        return jsonError(400, "invalid_group", error instanceof Error ? error.message : "Invalid group.");
      }
    }
    const account = await prisma().account.update({
      where: { id },
      data: {
        displayName: parsed.data.displayName,
        groupId: parsed.data.groupId,
        isAdmin: parsed.data.isAdmin,
      },
    });
    const change = await enqueueChange("account");
    return Response.json({ account: publicAccount(account), change });
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const existing = await prisma().account.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Account not found.");
    if (existing.kind === AccountKind.recovery) {
      return jsonError(409, "recovery_account", "The recovery admin cannot be removed.");
    }
    await revokeAccountSessions(id);
    await prisma().account.delete({ where: { id } });
    const change = await enqueueChange("account");
    return Response.json({ ok: true, change });
  });
}
