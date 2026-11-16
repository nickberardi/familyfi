import { z } from "zod";
import { isPrivateOrigin } from "@/lib/connection-routes";
import { requestOrigin } from "@/server/auth";
import { getHomeUrl, setHomeUrl } from "@/server/connection-endpoints";
import { readBody, withAdmin } from "@/server/guard";

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
  return withAdmin(request, async () => home(request, await getHomeUrl()));
}

export async function PUT(request: Request) {
  return withAdmin(request, async () => {
    const parsed = await readBody(request, Body, "Send a url, or null to clear it.");
    if (!parsed.ok) return parsed.response;
    return home(request, await setHomeUrl(parsed.data.url));
  }, { demoLock: true });
}
