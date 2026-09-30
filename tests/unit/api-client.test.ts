import { describe, expect, it, vi } from "vitest";
import { waitForChange, type ApiRequest } from "@/lib/api-client";

describe("waitForChange", () => {
  const polling = (statuses: string[]) => {
    const request = vi.fn(async () => ({ change: { status: statuses.shift() ?? "pending", error: null } }));
    return { send: request as unknown as ApiRequest, request };
  };

  it("polls every 750 ms until the change leaves pending", async () => {
    const { send, request } = polling(["pending", "pending", "applied"]);
    const sleep = vi.fn(async () => {});
    await expect(waitForChange(send, "c1", { sleep })).resolves.toEqual({ status: "applied", error: null });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenCalledWith("/api/v1/changes/c1");
    expect(sleep.mock.calls).toEqual([[750], [750]]);
  });

  it("gives up after 40 attempts and says it is still applying", async () => {
    const { send, request } = polling([]);
    const sleep = vi.fn(async () => {});
    await expect(waitForChange(send, "c1", { sleep })).resolves.toEqual({
      status: "pending",
      error: "Still applying. Check Sync for the latest result.",
    });
    expect(request).toHaveBeenCalledTimes(40);
  });
});
