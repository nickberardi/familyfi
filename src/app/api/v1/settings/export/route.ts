import { demoLocked } from "@/server/demo";
import { withAdmin } from "@/server/guard";
import { exportHousehold } from "@/server/household-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    // Every demo visitor shares one household; its export would hand out the others' work.
    const locked = demoLocked();
    if (locked) return locked;
    const { archive, filename } = await exportHousehold();
    return new Response(new Uint8Array(archive), {
      headers: {
        "content-type": "application/gzip",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  });
}
