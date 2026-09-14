export const LOCAL_INTEGRATION_PATH = "/proxy/network/integration";

export function consoleHostFromBaseUrl(baseUrl: string | null | undefined): string {
  if (!baseUrl) return "";
  try {
    const url = new URL(baseUrl);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return "";
  }
}

function formatHostForUrl(host: string): string {
  if (host.startsWith("[")) return host;
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(host)) return host;
  const colons = (host.match(/:/g) ?? []).length;
  if (colons > 1) return `[${host}]`;
  return host;
}

/** Build the official local integration base from a console IP, hostname, or accidental full URL. */
export function localIntegrationBaseFromHost(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Enter the UniFi console IP address.");
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") throw new Error("The UniFi console must be reached over https.");
    return `https://${url.host}${LOCAL_INTEGRATION_PATH}`;
  }
  const host = trimmed.split("/")[0]?.trim() ?? "";
  if (!host) throw new Error("Enter the UniFi console IP address.");
  return `https://${formatHostForUrl(host)}${LOCAL_INTEGRATION_PATH}`;
}
