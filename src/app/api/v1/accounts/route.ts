import { AccountKind } from "@prisma/client";
import { z } from "zod";
import { assertAdultFamilyGroup, assertPersonalUsername, normalizeUsername, publicAccount } from "@/server/accounts";
import { enqueueChange } from "@/server/changes";
import { hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";

const Create = z.object({
  username: z.string().min(2),
  displayName: z.string().min(1),
  password: z.string().min(8),
  groupId: z.string().min(1),
  isAdmin: z.boolean().optional(),
});

export async function GET(request: Request) {
  return withSession(request, async () => {
    const accounts = await prisma().account.findMany({ orderBy: { createdAt: "asc" } });
    return Response.json({ accounts: accounts.map(publicAccount) });
  });
}

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Create.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "username, displayName, password, and groupId are required.");
    const username = normalizeUsername(parsed.data.username);
    try {
      assertPersonalUsername(username);
    } catch (error) {
      return jsonError(400, "invalid_username", error instanceof Error ? error.message : "Invalid username.");
    }
    const group = await prisma().group.findUnique({ where: { id: parsed.data.groupId } });
    try {
      assertAdultFamilyGroup(group);
    } catch (error) {
      return jsonError(400, "invalid_group", error instanceof Error ? error.message : "Invalid group.");
    }
    const existing = await prisma().account.findUnique({ where: { username } });
    if (existing) return jsonError(409, "username_taken", "That username is already in use.");
    const account = await prisma().account.create({
      data: {
        username,
        displayName: parsed.data.displayName,
        kind: AccountKind.personal,
        isAdmin: parsed.data.isAdmin ?? true,
        groupId: parsed.data.groupId,
        passwordHash: await hashPassword(parsed.data.password),
      },
    });
    const change = await enqueueChange("account");
    return Response.json({ account: publicAccount(account), change }, { status: 201 });
  });
}
