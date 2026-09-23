import { PolicyOwnerScope, type Household } from "@prisma/client";
import { decryptSecret } from "../crypto";
import { unifiMockEnabled } from "../env";
import { UnifiConfigError } from "./errors";
import { HttpUnifiClient, type UnifiClient } from "./client";
import { resolveIntegrationBase } from "./base-url";
import { getSharedDevMockClient } from "./dev-mock";
import { withPolicyOwnership, type OwnershipScope } from "./policy-ownership";

export function connectionIdentity(household: Household): string {
  const site = household.unifiSiteId ?? "site";
  if (household.unifiMode === "cloud" && household.unifiConsoleId) {
    return `cloud:${household.unifiConsoleId}:${site}`;
  }
  return `local:${household.unifiBaseUrl ?? ""}:${site}`;
}

/** The console and site this household's policies are recorded against. */
export function ownershipScope(household: Household): OwnershipScope {
  return { connectionIdentity: connectionIdentity(household), siteId: household.unifiSiteId };
}

/** The household's UniFi client. It refuses to update or delete a policy FamilyFi has no record of. */
export function clientForHousehold(household: Household): UnifiClient {
  return withPolicyOwnership(unguardedClientForHousehold(household), ownershipScope(household));
}

function unguardedClientForHousehold(household: Household): UnifiClient {
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
        "Could not decrypt the stored UniFi API key. FAMILYFI_ENCRYPTION_KEY no longer matches the key used when it was saved. Restore the previous FAMILYFI_ENCRYPTION_KEY, or set a stable one and re-enter the API key in Settings.",
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
