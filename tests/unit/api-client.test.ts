import { describe, expect, it, vi } from "vitest";
import { ApiError, apiErrorNotice, apiErrorOf, errorNotice, TransportError, waitForChange, type ApiRequest } from "@/lib/api-client";

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

describe("API errors", () => {
  const link = { label: "Set up your own", url: "https://github.com/nickberardi/familyfi#install" };

  it("reads the code, message and link an error body carries", () => {
    const error = apiErrorOf({ error: { code: "demo_locked", message: "Locked.", link } }, 403);
    expect(error).toBeInstanceOf(ApiError);
    expect({ message: error.message, status: error.status, code: error.code, link: error.link }).toEqual({ message: "Locked.", status: 403, code: "demo_locked", link });
  });

  it("drops a link it can't use, and reads a body with no error", () => {
    expect(apiErrorOf({ error: { code: "x", message: "No.", link: { label: "Go" } } }, 400).link).toBeUndefined();
    for (const url of ["javascript:alert(1)", "http://example.com", "otherapp://open", "not a url"]) {
      expect(apiErrorOf({ error: { code: "x", message: "No.", link: { label: "Go", url } } }, 400).link).toBeUndefined();
    }
    const empty = apiErrorOf(null, 502);
    expect({ message: empty.message, code: empty.code }).toEqual({ message: "Request failed.", code: undefined });
  });

  it("turns a failure into what a card shows", () => {
    expect(errorNotice(apiErrorOf({ error: { code: "demo_locked", message: "Locked.", link } }, 403), "Failed.")).toEqual({ text: "Locked.", link });
    expect(errorNotice(new Error("Broke."), "Failed.")).toEqual({ text: "Broke." });
    expect(errorNotice("??", "Failed.")).toEqual({ text: "Failed." });
    expect(apiErrorNotice(new TransportError(new TypeError("offline")), "Failed.")).toEqual({ text: "Failed." });
  });
});
