import { PolicyOwnerScope, type Household } from "@prisma/client";
import { decryptSecret } from "../crypto";
import { unifiMockEnabled } from "../env";
import { UnifiConfigError } from "./errors";
import { HttpUnifiClient, type UnifiClient } from "./client";
import { resolveIntegrationBase } from "./base-url";
import { getSharedDevMockClient } from "./dev-mock";

export function connectionIdentity(household: Household): string {
  const site = household.unifiSiteId ?? "site";
  if (household.unifiMode === "cloud" && household.unifiConsoleId) {
    return `cloud:${household.unifiConsoleId}:${site}`;
  }
  return `local:${household.unifiBaseUrl ?? ""}:${site}`;
}

export function clientForHousehold(household: Household): UnifiClient {
  if (!household.unifiKeyCiphertext || !household.unifiKeyIv || !household.unifiKeyAuthTag) {
    throw new UnifiConfigError("UniFi is not configured.");
  }
  if (unifiMockEnabled()) return getSharedDevMockClient();
  let apiKey: string;
  try {
    apiKey = decryptSecret({
      ciphertext: Buffer.from(household.unifiKeyCiphertext),
      iv: Buffer.from(household.unifiKeyIv),
      authTag: Buffer.from(household.unifiKeyAuthTag),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/authenticate data|Unsupported state/i.test(message)) {
      throw new UnifiConfigError(
        "Could not decrypt the stored UniFi API key. APP_ENCRYPTION_KEY no longer matches the key used when it was saved. Restore the previous APP_ENCRYPTION_KEY, or set a stable one and re-enter the API key in Settings.",
      );
    }
    throw error;
  }
  return new HttpUnifiClient({
    apiKey,
    baseUrl: household.unifiBaseUrl ?? undefined,
    consoleId: household.unifiConsoleId ?? undefined,
    tlsInsecure: household.unifiTlsInsecure,
  });
}

export function probeClient(input: {
  apiKey: string;
  baseUrl?: string;
  consoleId?: string;
  tlsInsecure?: boolean;
}): UnifiClient {
  if (unifiMockEnabled()) return getSharedDevMockClient();
  resolveIntegrationBase({ baseUrl: input.baseUrl, consoleId: input.consoleId });
  return new HttpUnifiClient({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    consoleId: input.consoleId,
    tlsInsecure: input.tlsInsecure,
  });
}

export { PolicyOwnerScope };
