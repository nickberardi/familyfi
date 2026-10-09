import { describe, expect, it } from "vitest";
import { importSummaryLines } from "@/lib/backup-copy";
import type { ImportSummary } from "@/lib/types";

const summary = (over: Partial<ImportSummary> = {}): ImportSummary => ({
  exportedAt: "2026-10-09T15:00:00.000Z",
  appVersion: "0.27.0",
  counts: { groups: 3, accounts: 1, devices: 12, rules: 4, categories: 1, endpoints: 2 },
  gateway: "imported",
  unifiKey: "kept",
  endpointsNeedingToken: [],
  skippedEndpoints: [],
  otherInstallPolicies: false,
  databaseDump: true,
  ...over,
});

describe("import summary", () => {
  it("counts what the export holds", () => {
    expect(importSummaryLines(summary())).toEqual([
      "From FamilyFi v0.27.0, exported 2026-10-09.",
      "3 groups, 4 rules, 12 devices, 1 login, 1 DNS category, 2 routes.",
      "Phones, Watches and agents pair again; pairing is not part of an export.",
    ]);
  });

  it("names everything the operator must do afterwards", () => {
    const lines = importSummaryLines(
      summary({
        gateway: "kept",
        unifiKey: "missing",
        endpointsNeedingToken: ["https://familyfi.example.com"],
        skippedEndpoints: ["https://quick.trycloudflare.com"],
        otherInstallPolicies: true,
      }),
    );
    expect(lines).toContain("No UniFi key is saved here: paste one after the import.");
    expect(lines).toContain("This install's gateway connection stays: its key is for another console or site.");
    expect(lines).toContain("Switched off until you add their Cloudflare Access token: https://familyfi.example.com.");
    expect(lines).toContain("FamilyFi's own tunnel routes are not imported: turn remote access on again.");
    expect(lines.some((line) => line.includes("delete them in UniFi"))).toBe(true);
  });
});
