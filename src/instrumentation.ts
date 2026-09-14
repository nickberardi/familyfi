export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE) return;
  if (process.env.npm_lifecycle_event === "build") return;
  const { ConfigurationError, loadEnv } = await import("./server/env");
  let settings;
  try {
    settings = loadEnv();
  } catch (error) {
    const detail = error instanceof ConfigurationError ? error.issues.join("\n") : String(error);
    console.error("FamilyFi is missing required settings in .env:\n" + detail);
    return;
  }
  const { logRecoveryAdmin } = await import("./server/startup-banner");
  logRecoveryAdmin(settings.DEFAULT_PASSWORD);
  const { ensureRecoveryAccount } = await import("./server/auth");
  const { startReconciliation } = await import("./server/reconciliation");
  try {
    await ensureRecoveryAccount();
  } catch {
    // Database may not be up yet during `next build` or a local start.
  }
  startReconciliation();
}
