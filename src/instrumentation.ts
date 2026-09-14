export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadEnv } = await import("./server/env");
  try {
    loadEnv();
  } catch {
    return;
  }
  const { ensureRecoveryAccount } = await import("./server/auth");
  const { startReconciliation } = await import("./server/reconciliation");
  try {
    await ensureRecoveryAccount();
  } catch {
    // Database may not be up yet during `next build` or a local start.
  }
  startReconciliation();
}
