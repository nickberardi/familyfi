import { createHash, X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { connect } from "node:tls";
import { httpsOrigin } from "./connection";

export type CertificatePin = {
  spkiSha256: string;
  subject: string;
  issuer: string;
  validTo: string;
  /** Whether Node's CA store trusts the chain for this hostname; null when read from a pasted certificate. */
  systemTrusted: boolean | null;
  source: "probe" | "certificate";
};

export class ProbeError extends Error {}

/**
 * The pin a phone checks: SHA-256 of the certificate's DER SubjectPublicKeyInfo,
 * base64url without padding. Byte for byte the operator pipeline
 * `openssl x509 -pubkey | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary`
 * then base64url — hashed once, not twice.
 */
export function spkiSha256(certificate: X509Certificate): string {
  const der = certificate.publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("base64url");
}

function describe(certificate: X509Certificate, systemTrusted: boolean | null, source: CertificatePin["source"]): CertificatePin {
  return {
    spkiSha256: spkiSha256(certificate),
    subject: certificate.subject.replace(/\n/g, ", "),
    issuer: certificate.issuer.replace(/\n/g, ", "),
    validTo: new Date(certificate.validTo).toISOString(),
    systemTrusted,
    source,
  };
}

export function pinFromCertificate(pem: string): CertificatePin {
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(pem);
  } catch {
    throw new ProbeError("That is not a PEM certificate. Paste the block from -----BEGIN CERTIFICATE----- to -----END CERTIFICATE-----.");
  }
  return describe(certificate, null, "certificate");
}

/**
 * Reads the leaf certificate a route presents, from where FamilyFi sits. Only the
 * handshake happens — no HTTP request is sent — so this returns certificate facts and
 * nothing the server says.
 */
export async function probeCertificate(value: string, { timeoutMs = 5000 }: { timeoutMs?: number } = {}): Promise<CertificatePin> {
  const url = httpsOrigin(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = Number(url.port || 443);
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] });
    const fail = (message: string) => {
      socket.destroy();
      reject(new ProbeError(message));
    };
    socket.setTimeout(timeoutMs, () => fail(`No answer from ${url.host} within ${timeoutMs / 1000} seconds.`));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      fail(error.code === "ENOTFOUND" ? `FamilyFi could not resolve ${host}.` : `FamilyFi could not complete a TLS handshake with ${url.host} (${error.code ?? error.message}).`),
    );
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerX509Certificate();
      const trusted = socket.authorized;
      socket.end();
      if (!certificate) return fail(`${url.host} did not present a certificate.`);
      resolve(describe(certificate, trusted, "probe"));
    });
  });
}
