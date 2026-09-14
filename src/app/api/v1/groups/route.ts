import { FamilyRole, GroupKind } from "@prisma/client";
import { z } from "zod";
import { enqueueChange } from "@/server/changes";
import { publicGroup } from "@/server/groups";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";

const Create = z.object({
  kind: z.enum(["family", "things"]),
  name: z.string().min(1),
  monogram: z.string().max(4).optional(),
  familyRole: z.enum(["child", "teen", "adult"]).optional(),
  protected: z.boolean().optional(),
});

export async function GET(request: Request) {
  return withSession(request, async () => {
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const groups = await prisma().group.findMany({ include: { _count: { select: { devices: true } } }, orderBy: { createdAt: "asc" } });
    return Response.json({ groups: groups.map((group) => publicGroup(group, household.timezone)) });
  });
}

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Create.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "kind and name are required.");
    if (parsed.data.kind === "family" && !parsed.data.familyRole) {
      return jsonError(400, "invalid_request", "Family groups need a role.");
    }
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const group = await prisma().group.create({
      data: {
        kind: parsed.data.kind as GroupKind,
        name: parsed.data.name,
        monogram: parsed.data.monogram,
        familyRole: parsed.data.familyRole as FamilyRole | undefined,
        protected: parsed.data.protected ?? false,
      },
      include: { _count: { select: { devices: true } } },
    });
    const change = await enqueueChange("group");
    return Response.json({ group: publicGroup(group, household.timezone), change }, { status: 201 });
  });
}
