import { AccountKind } from "@prisma/client";
import { z } from "zod";
import { hashPassword, revokeAccountSessions } from "@/server/auth";
import { enqueueChange } from "@/server/changes";
import { publicAccount } from "@/server/accounts";
import { prisma } from "@/server/db";
import { readBody, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";

const Body = z.object({
  password: z.string().min(8),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const parsed = await readBody(request, Body, "password must be at least 8 characters.");
    if (!parsed.ok) return parsed.response;
    const existing = await prisma().account.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Account not found.");
    if (existing.kind === AccountKind.recovery) {
      return jsonError(409, "recovery_account", "Change FAMILYFI_DEFAULT_PASSWORD in .env for the recovery admin.");
    }
    const account = await prisma().account.update({
      where: { id },
      data: { passwordHash: await hashPassword(parsed.data.password) },
    });
    await revokeAccountSessions(id);
    const change = await enqueueChange("account");
    return Response.json({ account: publicAccount(account), change });
  }, { demoLock: true });
}
