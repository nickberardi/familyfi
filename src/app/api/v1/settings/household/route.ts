import { z } from "zod";
import { readBody, withMutation, withSession } from "@/server/guard";
import { getHouseholdSettings, updateHouseholdSettings } from "@/server/household";

const Body = z
  .object({
    timezone: z.string().min(1).optional(),
    displayName: z.string().trim().min(1).max(80).optional(),
    quarantineEnforced: z.boolean().optional(),
  })
  .refine((value) => value.timezone !== undefined || value.quarantineEnforced !== undefined || value.displayName !== undefined, {
    message: "timezone, displayName, or quarantineEnforced is required.",
  });

export async function GET(request: Request) {
  return withSession(request, async () => Response.json({ household: await getHouseholdSettings() }));
}

export async function PUT(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, Body, "timezone or quarantineEnforced is required.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await updateHouseholdSettings(parsed.data));
  }, { demoLock: true });
}
