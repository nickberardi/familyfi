import { describe, expect, it } from "vitest";
import { deleteDevice, setQuarantineEnforced } from "@/lib/device-writes";
import type { HouseholdStore, MutateOptions } from "@/lib/household-store";
import type { Device, Group } from "@/lib/types";

function recorder() {
  const sent: { path: string; init?: { method?: string; body?: unknown } }[] = [];
  let options: MutateOptions | undefined;
  const mutate: HouseholdStore["mutate"] = async (run, opts) => {
    options = opts;
    await run(async (path, init) => {
      sent.push({ path, init });
      return {} as never;
    });
    return undefined;
  };
  return { mutate, sent, options: () => options };
}

describe("device writes", () => {
  it("deletes a device by its encoded MAC and drops it from the list at once", async () => {
    const { mutate, sent, options } = recorder();
    await deleteDevice(mutate, { mac: "02:00:00:00:00:0a" });
    expect(sent).toEqual([{ path: "/api/v1/devices/02%3A00%3A00%3A00%3A00%3A0a", init: { method: "DELETE" } }]);
    const kept = { mac: "02:00:00:00:00:0b" } as Device;
    const lists = { groups: [] as Group[], devices: [{ mac: "02:00:00:00:00:0a" } as Device, kept] };
    expect(options()?.optimistic?.(lists).devices).toEqual([kept]);
  });

  it("turns quarantine on and off through the household settings", async () => {
    const { mutate, sent } = recorder();
    await setQuarantineEnforced(mutate, false);
    await setQuarantineEnforced(mutate, true);
    expect(sent).toEqual([
      { path: "/api/v1/settings/household", init: { method: "PUT", body: { quarantineEnforced: false } } },
      { path: "/api/v1/settings/household", init: { method: "PUT", body: { quarantineEnforced: true } } },
    ]);
  });
});
