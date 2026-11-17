import { z } from "zod";
import { readBody, withMutation, withSession } from "@/server/guard";
import { getHouseholdSettings, updateHouseholdSettings } from "@/server/household";

const Body = z
  .object({
    timezone: z.string().min(1).optional(),
    displayName: z.string().trim().min(1).max(80).optional(),
    quarantineEnforced: z.boolean().optional(),
    alertsRelay: z.boolean().optional(),
    /** How long a child's ask waits for an answer, 5 minutes to a day. */
    askTimeoutMinutes: z.number().int().min(5).max(1440).optional(),
    /** How long after a Not now a child can ask again, up to a day. */
    askWaitMinutes: z.number().int().min(0).max(1440).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "timezone, displayName, quarantineEnforced, alertsRelay, askTimeoutMinutes or askWaitMinutes is required.",
  });

export async function GET(request: Request) {
  return withSession(request, async () => Response.json({ household: await getHouseholdSettings() }));
}

export async function PUT(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, Body, "timezone, displayName, quarantineEnforced, alertsRelay, askTimeoutMinutes or askWaitMinutes is required.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await updateHouseholdSettings(parsed.data));
  }, { demoLock: true });
}
