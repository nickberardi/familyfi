/**
 * The behaviour FamilyFi relies on from the UniFi Integration API, as cases that run
 * against any `UnifiClient`. `tests/unit/unifi-client-contract.test.ts` runs them against
 * `MockUnifiClient` and a faked `HttpUnifiClient` in CI; `pnpm spike verify` runs the same
 * cases against a real console, so the mock cannot drift from firmware unnoticed.
 *
 * Every case works on a scratch policy it creates itself, for a locally administered MAC
 * no real device has, and deletes it again. None reads or writes an administrator's policy.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { UnifiClient } from "./client";
import { UnifiHttpError } from "./errors";
import { orderedPolicyIds } from "./ordering";
import { internetBlockPolicy, toPolicyUpdate } from "./payloads";
import type { FirewallPolicy, FirewallPolicyWrite } from "./types";

/** Locally administered: the bit no vendor-assigned MAC sets, so no real device matches it. */
export const CONTRACT_SCRATCH_MAC = "02:00:00:00:00:09";

export type ContractContext = {
  client: UnifiClient;
  siteId: string;
  /** Source zone the scratch policies are created in. */
  sourceZoneId: string;
  /** Destination zone, normally External. */
  destinationZoneId: string;
  /**
   * Called before a case writes to an id it did not create (the missing id it expects a 404
   * for), so a client behind the ownership guard lets the request reach the console.
   */
  claim?: (policyId: string) => void;
};

export type ContractCase = { name: string; run: (context: ContractContext) => Promise<void> };

function scratchPolicy(context: ContractContext, name: string): FirewallPolicyWrite {
  return internetBlockPolicy({
    name,
    sourceZoneId: context.sourceZoneId,
    destinationZoneId: context.destinationZoneId,
    macAddresses: [CONTRACT_SCRATCH_MAC],
    // Disabled: the contract is about the API, and a scratch policy should never enforce.
    enabled: false,
  });
}

/** Create a scratch policy, run `body`, and delete the policy whatever happens. */
async function withScratchPolicy(
  context: ContractContext,
  name: string,
  body: (policy: FirewallPolicy, write: FirewallPolicyWrite) => Promise<void>,
): Promise<void> {
  const write = scratchPolicy(context, name);
  const policy = await context.client.createPolicy(context.siteId, write);
  let deleted = false;
  try {
    await body(policy, write);
    await context.client.deletePolicy(context.siteId, policy.id);
    deleted = true;
  } finally {
    if (!deleted) await context.client.deletePolicy(context.siteId, policy.id).catch(() => undefined);
  }
}

export async function rejectsWithStatus(promise: Promise<unknown>, status: number, what: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof UnifiHttpError, `${what}: expected an HTTP ${status}, got ${error ? String(error) : "success"}`);
  assert.equal(error.status, status, `${what}: expected HTTP ${status}, got ${error.status}`);
}

export const UNIFI_CLIENT_CONTRACT: ContractCase[] = [
  {
    name: "answers 404 for a policy it does not have, on read, update and delete",
    async run(context) {
      const missing = randomUUID();
      await rejectsWithStatus(context.client.getPolicy(context.siteId, missing), 404, "read of a missing policy");
      context.claim?.(missing);
      const write = scratchPolicy(context, "FamilyFi Contract Missing");
      await rejectsWithStatus(context.client.updatePolicy(context.siteId, missing, write), 404, "update of a missing policy");
      await rejectsWithStatus(context.client.deletePolicy(context.siteId, missing), 404, "delete of a missing policy");
    },
  },
  {
    name: "replaces the whole policy on update, keeping only the server's own fields",
    async run(context) {
      await withScratchPolicy(context, "FamilyFi Contract Replace", async (created) => {
        // A field the next write leaves out must not survive it: PUT is not a merge.
        await context.client.updatePolicy(context.siteId, created.id, toPolicyUpdate(created, { ipsecFilter: "MATCH_ENCRYPTED" }));
        const write = scratchPolicy(context, "FamilyFi Contract Replaced");
        const updated = await context.client.updatePolicy(context.siteId, created.id, write);
        assert.deepEqual(
          updated,
          { ...write, id: created.id, index: created.index, metadata: created.metadata },
          "PUT answers with exactly the write body plus id, index and metadata",
        );
        assert.ok(!Object.hasOwn(updated, "ipsecFilter"), "a field the PUT left out is gone");
        assert.deepEqual(await context.client.getPolicy(context.siteId, created.id), updated, "a read after PUT matches its answer");
      });
    },
  },
  {
    name: "creates a policy with a new id, and deletes it for good",
    async run(context) {
      const write = scratchPolicy(context, "FamilyFi Contract Create");
      const created = await context.client.createPolicy(context.siteId, write);
      try {
        assert.ok(created.id, "a created policy has an id");
        const { metadata, ...rest } = created;
        assert.equal(metadata.origin, "USER_DEFINED", "a created policy is USER_DEFINED");
        for (const [key, value] of Object.entries(write)) {
          assert.deepEqual(rest[key as keyof typeof rest], value, `a created policy keeps ${key}`);
        }
      } finally {
        await context.client.deletePolicy(context.siteId, created.id);
      }
      await rejectsWithStatus(context.client.getPolicy(context.siteId, created.id), 404, "read of a deleted policy");
    },
  },
  {
    name: "reads policy ordering only per source zone",
    async run(context) {
      await rejectsWithStatus(context.client.getPolicyOrdering(context.siteId), 400, "ordering read without a source zone");
      await withScratchPolicy(context, "FamilyFi Contract Ordering", async (created) => {
        const ordering = await context.client.getPolicyOrdering(context.siteId, context.sourceZoneId);
        const ids = orderedPolicyIds(ordering);
        assert.ok(ids.includes(created.id), "a new policy appears in its source zone's ordering");
        for (const id of ids) {
          const policy = await context.client.getPolicy(context.siteId, id);
          assert.equal(policy.source.zoneId, context.sourceZoneId, "every policy in a zone's ordering has that source zone");
        }
      });
    },
  },
];
