import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnifiClient } from "@/server/unifi/client";
import { DPI_CATALOG_MS, dpiCatalog, forgetDpiCatalogs } from "@/server/unifi/dpi-catalog";

function gateway(listDpiApplications: () => Promise<{ id: number; name: string }[]>) {
  return { listDpiApplications: vi.fn(listDpiApplications), listDpiCategories: vi.fn(async () => []) } as unknown as UnifiClient & {
    listDpiApplications: ReturnType<typeof vi.fn>;
  };
}

describe("DPI catalog cache", () => {
  afterEach(() => forgetDpiCatalogs());

  it("shares one read per console until it is an hour old", async () => {
    const client = gateway(async () => [{ id: 1, name: "Video" }]);
    await Promise.all([dpiCatalog("console-a", "applications", client, 0), dpiCatalog("console-a", "applications", client, 10)]);
    expect(client.listDpiApplications).toHaveBeenCalledTimes(1);

    await dpiCatalog("console-b", "applications", client, 20);
    expect(client.listDpiApplications).toHaveBeenCalledTimes(2);

    await dpiCatalog("console-a", "applications", client, DPI_CATALOG_MS + 1);
    expect(client.listDpiApplications).toHaveBeenCalledTimes(3);
  });

  it("asks again after a failed read", async () => {
    const client = gateway(async () => {
      throw new Error("gateway timed out");
    });
    await expect(dpiCatalog("console-a", "applications", client, 0)).rejects.toThrow("gateway timed out");
    await expect(dpiCatalog("console-a", "applications", client, 1)).rejects.toThrow("gateway timed out");
    expect(client.listDpiApplications).toHaveBeenCalledTimes(2);
  });
});
