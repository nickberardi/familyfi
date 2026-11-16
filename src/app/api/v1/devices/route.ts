import { AssignmentState } from "@prisma/client";
import { publicDevice, deviceScope } from "@/server/devices";
import { prisma } from "@/server/db";
import { withSession } from "@/server/guard";
import { loadHousehold } from "@/server/household";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const url = new URL(request.url);
    const assignment = url.searchParams.get("assignment");
    const household = await loadHousehold();
    const devices = await prisma().device.findMany({
      where:
        assignment === "quarantined"
          ? { assignment: AssignmentState.quarantined }
          : assignment === "assigned"
            ? { assignment: AssignmentState.assigned }
            : {},
      orderBy: { mac: "asc" },
    });
    return Response.json({
      devices: devices.map((device) => publicDevice(device, deviceScope(household), new Date(), household.presenceCheckedAt)),
    });
  });
}
