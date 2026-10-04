export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE) return;
  if (process.env.npm_lifecycle_event === "build") return;
  const { ConfigurationError, loadEnv, unifiMockWarning } = await import("./server/env");
  let settings;
  try {
    settings = loadEnv();
  } catch (error) {
    const detail = error instanceof ConfigurationError ? error.issues.join("\n") : String(error);
    console.error("FamilyFi is missing required settings in .env:\n" + detail);
    return;
  }
  const { logDemoMode, logRecoveryAdmin, logUnifiMock } = await import("./server/startup-banner");
  logRecoveryAdmin(settings.FAMILYFI_DEFAULT_PASSWORD);
  if (settings.FAMILYFI_MODE === "demo") logDemoMode();
  else if (settings.FAMILYFI_MODE !== "prod") logUnifiMock(settings.FAMILYFI_MODE);
  const retired = unifiMockWarning();
  if (retired) console.warn(retired);
  const { startUpdateCheck } = await import("./server/update-check");
  const { ensureHousehold, ensureRecoveryAccount } = await import("./server/auth");
  const { ensureUpstreamCategories } = await import("./server/upstream-seed");
  const { startReconciliation } = await import("./server/reconciliation");
  const { startUpstreamProbe } = await import("./server/upstream/schedule");
  try {
    await ensureRecoveryAccount();
    await ensureHousehold();
    await ensureUpstreamCategories();
    if (settings.FAMILYFI_MODE !== "prod") {
      const { ensureDevDummyData } = await import("./server/dev-seed");
      await ensureDevDummyData();
    }
  } catch {
    // Database may not be up yet during `next build` or a local start.
  }
  if (settings.FAMILYFI_MODE === "demo") {
    const { ensureDemoRoute, startDemoReset } = await import("./server/demo");
    // Separately, so a bad FAMILYFI_DEMO_URL never stops the nightly reset.
    await startDemoReset().then(
      (at) => console.log(`demo mode: the household resets at ${at.toISOString()}`),
      (error) => console.error("Demo mode could not schedule its nightly reset:", error),
    );
    await ensureDemoRoute().catch((error) => console.error("Demo mode could not publish FAMILYFI_DEMO_URL:", error));
  }
  startUpdateCheck();
  startReconciliation();
  startUpstreamProbe();
  const { resumeRemoteAccess, startSidecarGateway } = await import("./server/tunnel/remote-access");
  const sidecarPort = Number(process.env.FAMILYFI_PHONE_GATEWAY_PORT);
  if (Number.isInteger(sidecarPort) && sidecarPort > 0 && sidecarPort < 65536) {
    void startSidecarGateway(sidecarPort).catch((error) => console.error("Phone-only gateway did not start:", error));
  }
  void resumeRemoteAccess().catch((error) => console.error("Remote access did not start:", error));
}
