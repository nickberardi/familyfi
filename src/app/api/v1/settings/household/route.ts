import { z } from "zod";
import { prisma } from "@/server/db";
import { enqueueChange } from "@/server/changes";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";

const Body = z.object({
  timezone: z.string().min(1),
});

export async function GET(request: Request) {
  return withSession(request, async () => {
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    return Response.json({
      household: { timezone: household.timezone, revision: household.revision },
    });
  });
}

export async function PUT(request: Request) {
  return withMutation(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "timezone is required.");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone });
    } catch {
      return jsonError(400, "invalid_timezone", "Use an IANA timezone name.");
    }
    const household = await prisma().household.update({
      where: { id: "default" },
      data: { timezone: parsed.data.timezone },
    });
    const change = await enqueueChange("household");
    return Response.json({
      household: { timezone: household.timezone, revision: household.revision },
      change,
    });
  });
}
