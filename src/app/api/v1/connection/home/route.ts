import { z } from "zod";
import { homeOrigin, isPrivateOrigin } from "@/lib/connection-routes";
import { requestOrigin } from "@/server/auth";
import { prisma } from "@/server/db";
import { demoLocked } from "@/server/demo";
import { readBody, withAdmin } from "@/server/guard";
import { jsonError } from "@/server/http";
import { loadHousehold } from "@/server/household";

const Body = z.object({ url: z.string().max(2048).nullable() }).strict();

/**
 * Home access: where FamilyFi is on the home network, apart from Remote access, the outside route.
 * Agents pair here, so it must not sit behind a sign-in page. `current` is the address this request
 * reached FamilyFi at, which Home access suggests when nothing is saved and it is `private`.
 */
function home(request: Request, url: string | null) {
  const current = requestOrigin(request);
  return Response.json({ home: { url, current: { url: current, private: isPrivateOrigin(current) } } });
}

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const household = await loadHousehold();
    return home(request, household.homeUrl);
  });
}

export async function PUT(request: Request) {
  return withAdmin(request, async () => {
    const locked = demoLocked();
    if (locked) return locked;
    const parsed = await readBody(request, Body, "Send a url, or null to clear it.");
    if (!parsed.ok) return parsed.response;
    const blank = parsed.data.url === null || parsed.data.url.trim() === "";
    const url = blank ? null : homeOrigin(parsed.data.url!);
    if (!blank && !url) return jsonError(400, "invalid_home_url", "Use an http or https address with no path, such as http://192.168.1.10:7001.");
    const household = await prisma().household.update({ where: { id: "default" }, data: { homeUrl: url } });
    return home(request, household.homeUrl);
  });
}
