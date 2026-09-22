import { z } from "zod";
import { prisma } from "@/server/db";
import { enqueueChange } from "@/server/changes";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { observeQuarantineBlocking } from "@/server/quarantine";
import { rescheduleUpstreamProbe } from "@/server/upstream/schedule";
import type { Household } from "@prisma/client";

const Body = z
  .object({
    timezone: z.string().min(1).optional(),
    displayName: z.string().trim().min(1).max(80).optional(),
    quarantineEnforced: z.boolean().optional(),
  })
  .refine((value) => value.timezone !== undefined || value.quarantineEnforced !== undefined || value.displayName !== undefined, {
    message: "timezone, displayName, or quarantineEnforced is required.",
  });

export async function publicHousehold(household: Household) {
  const live = await observeQuarantineBlocking(household);
  return {
    timezone: household.timezone,
    revision: household.revision,
    quarantineEnforced: household.quarantineEnforced,
    quarantineObservedEnabled: live.observedEnabled,
    quarantinePolicyCount: live.policyCount,
    displayName: household.displayName,
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
        ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
      },
    });
    const change = await enqueueChange(parsed.data.quarantineEnforced !== undefined ? "quarantine" : "household");
    if (parsed.data.timezone) rescheduleUpstreamProbe();
    return Response.json({
      household: await publicHousehold(household),
      change,
    });
  });
}
