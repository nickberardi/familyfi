import { PolicyOwnerScope, type Household } from "@prisma/client";
import { decryptSecret } from "../crypto";
import { UnifiConfigError } from "./errors";
import { HttpUnifiClient, type UnifiClient } from "./client";
import { resolveIntegrationBase } from "./base-url";

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
  const apiKey = decryptSecret({
    ciphertext: Buffer.from(household.unifiKeyCiphertext),
    iv: Buffer.from(household.unifiKeyIv),
    authTag: Buffer.from(household.unifiKeyAuthTag),
  });
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
  resolveIntegrationBase({ baseUrl: input.baseUrl, consoleId: input.consoleId });
  return new HttpUnifiClient({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    consoleId: input.consoleId,
    tlsInsecure: input.tlsInsecure,
  });
}

export { PolicyOwnerScope };
