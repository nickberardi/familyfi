import { enqueueChange } from "@/server/changes";
import { demoLocked } from "@/server/demo";
import { withAdmin } from "@/server/guard";
import { applyImport, browserOnly, HouseholdImportError, IMPORT_MAX_BYTES, previewImport } from "@/server/household-export";
import { jsonError } from "@/server/http";
import { rescheduleAutoUpdate } from "@/server/updater";
import { rescheduleUpstreamProbe } from "@/server/upstream/schedule";

/** The upload, refused as soon as it passes the cap rather than after it is all in memory. */
async function readUpload(request: Request): Promise<Buffer | null> {
  if (Number(request.headers.get("content-length") ?? 0) > IMPORT_MAX_BYTES) return null;
  if (!request.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.length;
    if (size > IMPORT_MAX_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function POST(request: Request) {
  return withAdmin(request, async (session) => {
    const refused = browserOnly(session);
    if (refused) return refused;
    const locked = demoLocked();
    if (locked) return locked;
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode !== "preview" && mode !== "apply") return jsonError(400, "invalid_request", "Send mode=preview or mode=apply.");
    const upload = await readUpload(request);
    if (!upload) return jsonError(413, "export_too_large", "A FamilyFi export is at most 50 MB.");
    try {
      if (mode === "preview") return Response.json({ summary: await previewImport(upload), change: null });
      const summary = await applyImport(upload, { accountId: session.accountId });
      const change = await enqueueChange("import");
      rescheduleUpstreamProbe();
      rescheduleAutoUpdate();
      return Response.json({ summary, change });
    } catch (error) {
      if (error instanceof HouseholdImportError) {
        return jsonError(error.code === "export_too_new" ? 409 : 400, error.code, error.message);
      }
      throw error;
    }
  });
}
