import { readBody, withMutation, withSession } from "@/server/guard";
import { getUnifiSettings, UnifiSettingsBody, updateUnifiSettings } from "@/server/unifi-settings";

export async function GET(request: Request) {
  return withSession(request, async () => Response.json({ unifi: await getUnifiSettings() }));
}

export async function PUT(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, UnifiSettingsBody, "Provide an API key and UniFi target, or a managed network selection.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await updateUnifiSettings(parsed.data));
  }, { demoLock: true });
}
