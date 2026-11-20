import { describe, expect, it } from "vitest";
import { deviceTokenAppVersion, namedAppVersion, newDeviceToken } from "@/server/device-token";

describe("device tokens", () => {
  it("gives a device that names no app version a bare random token, which carries none", () => {
    const token = newDeviceToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deviceTokenAppVersion(token)).toBeNull();
    expect(newDeviceToken(null)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("carries the app version, a payload version and a fresh random string", () => {
    const token = newDeviceToken("2.1.0");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(deviceTokenAppVersion(token)).toBe("2.1.0");
    const payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    expect(payload).toEqual({ v: 1, appVersion: "2.1.0", token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(newDeviceToken("2.1.0")).not.toBe(token);
  });

  it("reads no version from anything that is not its payload", () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    expect(deviceTokenAppVersion(encode({ v: 2, appVersion: "2.1.0", token: "x" }))).toBeNull();
    expect(deviceTokenAppVersion(encode({ v: 1, appVersion: "latest", token: "x" }))).toBeNull();
    expect(deviceTokenAppVersion(encode({ v: 1, appVersion: "2.1.0" }))).toBeNull();
    expect(deviceTokenAppVersion(encode(["2.1.0", "with padding to pass the bare token length"]))).toBeNull();
    expect(deviceTokenAppVersion("not base64 json, but longer than a bare token is")).toBeNull();
  });

  it("reads app versions as the apps write them, their X.Y marketing version among them, and ignores anything else", () => {
    for (const version of ["2.0", "2.1", "2.0.0", "2.1.0", "10.20.300", "2.1.0-beta.1", "2.1.0+42"]) expect(namedAppVersion(version)).toBe(version);
    for (const version of [undefined, null, 2.1, "", "2", "v2.1.0", "2.1.0 ", "2.1.0\n", "x".repeat(65)]) expect(namedAppVersion(version)).toBeNull();
  });
});
