import { z } from "zod";
import { jsonError } from "@/server/http";
import { readJson, withAdmin } from "@/server/guard";
import { ProbeError, pinFromCertificate, probeCertificate } from "@/server/spki";

const Body = z.union([z.object({ url: z.string().min(1) }).strict(), z.object({ certificate: z.string().min(1).max(20_000) }).strict()]);

/** Computes the SPKI pin for a pinned LAN route, from the live address or a pasted certificate. */
export async function POST(request: Request) {
  return withAdmin(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Send either a route url or a PEM certificate.");
    try {
      const pin = "url" in parsed.data ? await probeCertificate(parsed.data.url) : pinFromCertificate(parsed.data.certificate);
      return Response.json({ pin });
    } catch (error) {
      if (error instanceof ProbeError) return jsonError(422, "probe_failed", error.message);
      if (error instanceof Error && /HTTPS origin/.test(error.message)) return jsonError(400, "invalid_endpoint", error.message);
      throw error;
    }
  });
}
