import { LOCAL_INTEGRATION_PATH } from "@/lib/unifi-host";
import { UnifiConfigError } from "./errors";

export function resolveIntegrationBase(input: { baseUrl?: string; consoleId?: string }): string {
  const baseUrl = input.baseUrl?.trim();
  const consoleId = input.consoleId?.trim();
  if (baseUrl && consoleId) {
    throw new UnifiConfigError("Use a local integration URL or a cloud console ID, not both.");
  }
  if (consoleId) {
    if (!/^[A-Za-z0-9:_-]+$/.test(consoleId)) {
      throw new UnifiConfigError("The console ID contains characters that are not valid in the cloud connector path.");
    }
    return `https://api.ui.com/v1/connector/consoles/${consoleId}${LOCAL_INTEGRATION_PATH}`;
  }
  if (!baseUrl) {
    throw new UnifiConfigError(
      "Needs a local integration URL or a cloud console ID. Local URL format: https://<console-ip>/proxy/network/integration",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new UnifiConfigError(
      "The integration URL must be a complete https URL such as https://192.168.0.1/proxy/network/integration. A bare hostname is not an integration base.",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new UnifiConfigError("The integration URL must use https.");
  }
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  if (path !== LOCAL_INTEGRATION_PATH) {
    throw new UnifiConfigError(
      `The integration URL must be https://<console-ip>${LOCAL_INTEGRATION_PATH} (got path ${path}). Do not omit the integration path or append /v1.`,
    );
  }
  return `${parsed.origin}${LOCAL_INTEGRATION_PATH}`;
}

export function localIntegrationUrlExample(consoleIp = "192.168.0.1"): string {
  return `https://${consoleIp}${LOCAL_INTEGRATION_PATH}`;
}
