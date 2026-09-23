import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProbeError, pinFromCertificate, probeCertificate } from "@/server/spki";

/** The exact pipeline issue #60 gives operators, run by a shell. */
function opensslPin(certPath: string): string {
  return execSync(
    `openssl x509 -in "${certPath}" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='`,
  )
    .toString()
    .trim();
}

// Keys are minted per run so no private key is ever committed.
const KEYS = {
  "EC P-256": ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1"],
  "RSA 2048": ["-newkey", "rsa:2048"],
} as const;

describe("SPKI pin", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "familyfi-spki-"));
  const certs: Record<string, { cert: string; key: string; certPath: string }> = {};

  beforeAll(() => {
    for (const [name, args] of Object.entries(KEYS)) {
      const base = path.join(dir, name.replace(/\W/g, ""));
      execFileSync("openssl", ["req", "-x509", ...args, "-nodes", "-days", "2", "-subj", "/CN=familyfi.test", "-keyout", `${base}.key`, "-out", `${base}.pem`], { stdio: "ignore" });
      certs[name] = { cert: readFileSync(`${base}.pem`, "utf8"), key: readFileSync(`${base}.key`, "utf8"), certPath: `${base}.pem` };
    }
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  for (const name of Object.keys(KEYS)) {
    it(`matches the openssl pipeline for ${name}`, () => {
      const pin = pinFromCertificate(certs[name].cert);
      expect(pin.spkiSha256).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(pin.spkiSha256).toBe(opensslPin(certs[name].certPath));
      expect(pin.subject).toContain("CN=familyfi.test");
      expect(pin.systemTrusted).toBeNull();
    });
  }

  it("rejects text that is not a certificate", () => {
    expect(() => pinFromCertificate("not a cert")).toThrow(ProbeError);
  });

  describe("reading a live route", () => {
    let server: Server;
    let origin: string;

    beforeAll(async () => {
      const { cert, key } = certs["EC P-256"];
      server = createServer({ cert, key }, (_req, res) => res.end("ok"));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it("reads the same pin the certificate file gives, and knows a self-signed cert is not system-trusted", async () => {
      const pin = await probeCertificate(origin);
      expect(pin.spkiSha256).toBe(opensslPin(certs["EC P-256"].certPath));
      expect(pin.systemTrusted).toBe(false);
      expect(pin.source).toBe("probe");
    });

    it("explains a route nothing is listening on", async () => {
      const closed = createServer();
      await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
      const port = (closed.address() as AddressInfo).port;
      await new Promise<void>((resolve) => closed.close(() => resolve()));
      await expect(probeCertificate(`https://127.0.0.1:${port}`)).rejects.toThrow(/TLS handshake/);
    });

    it("refuses anything but a bare HTTPS origin", async () => {
      await expect(probeCertificate("http://127.0.0.1")).rejects.toThrow(/HTTPS origin/);
      await expect(probeCertificate(`${origin}/path`)).rejects.toThrow(/HTTPS origin/);
    });
  });
});
