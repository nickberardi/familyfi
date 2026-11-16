/**
 * Server start-up: checks the settings, prepares the household and starts the background work.
 * Modules load one at a time, as they are needed, so a start that stops early loads nothing more.
 */
export async function boot() {
  const { ConfigurationError, loadEnv, unifiMockWarning } = await import("./env");
  let settings;
  try {
    settings = loadEnv();
  } catch (error) {
    const detail = error instanceof ConfigurationError ? error.issues.join("\n") : String(error);
    console.error("FamilyFi is missing required settings in .env:\n" + detail);
    return;
  }
  const { logDemoMode, logRecoveryAdmin, logUnifiMock } = await import("./startup-banner");
  logRecoveryAdmin(settings.FAMILYFI_DEFAULT_PASSWORD);
  if (settings.FAMILYFI_MODE === "demo") logDemoMode();
  else if (settings.FAMILYFI_MODE !== "prod") logUnifiMock(settings.FAMILYFI_MODE);
  const retired = unifiMockWarning();
  if (retired) console.warn(retired);
  const { startUpdateCheck } = await import("./update-check");
  const { ensureHousehold, ensureRecoveryAccount, settleRecoveryPassword } = await import("./auth");
  const { ensureUpstreamCategories } = await import("./upstream-seed");
  const { startReconciliation } = await import("./reconciliation");
  const { startUnifiRequestLog } = await import("./unifi/request-meter");
  const { startUpstreamProbe } = await import("./upstream/schedule");
  const { startAutoUpdate } = await import("./updater");
  try {
    await ensureRecoveryAccount();
    if (await settleRecoveryPassword()) console.log("The recovery admin password changed, so its sessions were signed out.");
    await ensureHousehold();
    await ensureUpstreamCategories();
    if (settings.FAMILYFI_MODE !== "prod") {
      const { ensureDevDummyData } = await import("./dev-seed");
      await ensureDevDummyData();
    }
  } catch (error) {
    // Database may not be up yet during `next build` or a local start. The demo's database is
    // in memory and already migrated, so a failure there is real: exit, and the platform restarts it.
    console.error("FamilyFi could not prepare the household:", error);
    if (settings.FAMILYFI_MODE === "demo") process.exit(1);
  }
  if (settings.FAMILYFI_MODE === "demo") {
    const { ensureDemoRoute, startDemoReset } = await import("./demo");
    // Separately, so a bad FAMILYFI_DEMO_URL never stops the nightly reset.
    await startDemoReset().then(
      (at) => console.log(`demo mode: the household resets at ${at.toISOString()}`),
      (error) => console.error("Demo mode could not schedule its nightly reset:", error),
    );
    await ensureDemoRoute().catch((error) => console.error("Demo mode could not publish FAMILYFI_DEMO_URL:", error));
  }
  startUpdateCheck();
  startReconciliation();
  startUnifiRequestLog();
  startUpstreamProbe();
  startAutoUpdate();
  const { resumeRemoteAccess, startRemoteAccessPort } = await import("./tunnel/remote-access");
  const remotePort = Number(process.env.FAMILYFI_REMOTE_ACCESS_PORT?.trim() || "7002");
  // The demo publishes its own public route and is reached through it, never this port.
  if (settings.FAMILYFI_MODE === "demo") {
    // Nothing to open.
  } else if (Number.isInteger(remotePort) && remotePort > 0 && remotePort < 65536) {
    void startRemoteAccessPort(remotePort).catch((error) => console.error("Remote access port did not start:", error));
  } else {
    console.error("FAMILYFI_REMOTE_ACCESS_PORT must be a port number; the remote access port is off.");
  }
  void resumeRemoteAccess().catch((error) => console.error("Remote access did not start:", error));
}
