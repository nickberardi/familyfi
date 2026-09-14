import { z } from "zod";
import { prisma } from "@/server/db";
import { enqueueChange } from "@/server/changes";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { observeQuarantineBlocking } from "@/server/quarantine";
import type { Household } from "@prisma/client";

const Body = z
  .object({
    timezone: z.string().min(1).optional(),
    quarantineEnforced: z.boolean().optional(),
  })
  .refine((value) => value.timezone !== undefined || value.quarantineEnforced !== undefined, {
    message: "timezone or quarantineEnforced is required.",
  });

export async function publicHousehold(household: Household) {
  const live = await observeQuarantineBlocking(household);
  return {
    timezone: household.timezone,
    revision: household.revision,
    quarantineEnforced: household.quarantineEnforced,
    quarantineObservedEnabled: live.observedEnabled,
    quarantinePolicyCount: live.policyCount,
  };
}

export async function GET(request: Request) {
  return withSession(request, async () => {
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    return Response.json({ household: await publicHousehold(household) });
  });
}

export async function PUT(request: Request) {
  return withMutation(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "timezone or quarantineEnforced is required.");
    if (parsed.data.timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone });
      } catch {
        return jsonError(400, "invalid_timezone", "Use an IANA timezone name.");
      }
    }
    const household = await prisma().household.update({
      where: { id: "default" },
      data: {
        ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
        ...(parsed.data.quarantineEnforced !== undefined ? { quarantineEnforced: parsed.data.quarantineEnforced } : {}),
      },
    });
    const change = await enqueueChange(parsed.data.quarantineEnforced !== undefined ? "quarantine" : "household");
    return Response.json({
      household: await publicHousehold(household),
      change,
    });
  });
}
