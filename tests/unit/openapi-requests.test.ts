/**
 * The integration suite checks every request a test sends against the OpenAPI document
 * through `checkedHandler`. These cases pin the checker itself: a request the document
 * allows reaches the handler, one it forbids fails the test with the method, path and
 * schema error, and `invalidRequest` lets a negative-path test through only when the
 * request really is invalid and the handler really refuses it.
 */

import { describe, expect, it, vi } from "vitest";
import { checkedHandler, invalidRequest, requestProblems } from "../helpers/openapi-responses";

const SCHEDULE = "/api/v1/groups/{id}/schedule";
const ORIGIN = "http://familyfi.test";
const context = { params: Promise.resolve({ id: "group-1" }) };

const put = (body: unknown, url = `${ORIGIN}/api/v1/groups/group-1/schedule`) =>
  new Request(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const valid = { enabled: false, days: [1], start: "21:00", end: "07:00" };
const refusal = () => Response.json({ error: { code: "invalid_schedule", message: "Invalid schedule." } }, { status: 400 });

function scheduleHandler(respond: () => Response) {
  const handler = vi.fn<(request: Request, ctx: typeof context) => Promise<Response>>(async () => respond());
  return { handler, checked: checkedHandler("PUT", SCHEDULE, handler) };
}

describe("OpenAPI request checks", () => {
  it("passes a request the document allows through to the handler", async () => {
    const { handler, checked } = scheduleHandler(refusal);
    expect((await checked(put(valid), context)).status).toBe(400);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("fails a body the document forbids, naming the method, path and schema error, before the handler runs", async () => {
    const { handler, checked } = scheduleHandler(refusal);
    await expect(checked(put({ ...valid, start: null }), context)).rejects.toThrow(
      /^PUT \/api\/v1\/groups\/\{id\}\/schedule request does not match the OpenAPI document: body\/start must be string/,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("reports a missing body, a body the operation does not take, a body that is not JSON, and query parameters", async () => {
    const empty = new Request(`${ORIGIN}/api/v1/groups/group-1/schedule`, { method: "PUT" });
    expect(await requestProblems("PUT", SCHEDULE, { request: empty, params: { id: "group-1" } })).toEqual(["the request body is required"]);

    const pause = new Request(`${ORIGIN}/api/v1/groups/group-1/resume`, { method: "POST", body: "{}" });
    expect(await requestProblems("POST", "/api/v1/groups/{id}/resume", { request: pause, params: { id: "group-1" } })).toEqual([
      "sends a body, but the operation documents none",
    ]);

    const garbled = new Request(`${ORIGIN}/api/v1/groups/group-1/schedule`, { method: "PUT", body: "{" });
    expect(await requestProblems("PUT", SCHEDULE, { request: garbled, params: { id: "group-1" } })).toEqual(["the body is not JSON: {"]);

    const undocumented = put(valid, `${ORIGIN}/api/v1/groups/group-1/schedule?force=1`);
    expect(await requestProblems("PUT", SCHEDULE, { request: undocumented, params: { id: "group-1" } })).toEqual([
      'query parameter "force" is not documented',
    ]);

    const devices = (query: string) => new Request(`${ORIGIN}/api/v1/connection/devices${query}`, { method: "DELETE" });
    expect(await requestProblems("DELETE", "/api/v1/connection/devices", { request: devices("") })).toEqual([
      'query parameter "revoked" is required',
    ]);
    expect(await requestProblems("DELETE", "/api/v1/connection/devices", { request: devices("?revoked=yes") })).toEqual([
      'query parameter "revoked": data must be equal to one of the allowed values',
    ]);
    expect(await requestProblems("DELETE", "/api/v1/connection/devices", { request: devices("?revoked=true") })).toEqual([]);
  });

  it("checks path parameters, and a handler called with no request at all", async () => {
    expect(await requestProblems("PUT", SCHEDULE, { request: put(valid) })).toEqual(['path parameter "id" is required']);
    expect(await requestProblems("GET", "/api/v1/health", {})).toEqual([]);
  });

  it("lets a request marked invalidRequest reach the handler when it breaks the document and is refused", async () => {
    const { handler, checked } = scheduleHandler(refusal);
    expect((await checked(invalidRequest(put({ ...valid, start: null })), context)).status).toBe(400);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("fails a request marked invalidRequest that matches the document", async () => {
    const { checked } = scheduleHandler(refusal);
    await expect(checked(invalidRequest(put(valid)), context)).rejects.toThrow(/marked invalidRequest but matches the OpenAPI document/);
  });

  it("fails a request marked invalidRequest that the handler accepts", async () => {
    const { checked } = scheduleHandler(() => Response.json({}, { status: 200 }));
    await expect(checked(invalidRequest(put({ ...valid, start: null })), context)).rejects.toThrow(/answered 200, not a 4xx/);
  });
});
