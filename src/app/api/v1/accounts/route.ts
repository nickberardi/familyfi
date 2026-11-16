import { z } from "zod";
import { createAccount, listAccounts } from "@/server/accounts";
import { readBody, withMutation, withSession } from "@/server/guard";

const Create = z.object({
  username: z.string().min(2),
  displayName: z.string().min(1),
  password: z.string().min(8),
  groupId: z.string().min(1),
  isAdmin: z.boolean().optional(),
});

export async function GET(request: Request) {
  return withSession(request, async () => Response.json({ accounts: await listAccounts() }));
}

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, Create, "username, displayName, password, and groupId are required.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await createAccount(parsed.data), { status: 201 });
  }, { demoLock: true });
}
