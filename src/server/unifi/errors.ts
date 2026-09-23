export class UnifiHttpError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: string;

  constructor(status: number, method: string, path: string, body: string) {
    super(`UniFi ${method} ${path} failed with HTTP ${status}${body ? `: ${body.slice(0, 500)}` : ""}`);
    this.name = "UnifiHttpError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

export class UnifiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnifiConfigError";
  }
}

export class UnifiTimeoutError extends Error {
  constructor(method: string, path: string) {
    super(`UniFi ${method} ${path} timed out`);
    this.name = "UnifiTimeoutError";
  }
}

/** A write to a UniFi policy FamilyFi has no record of creating on this console and site. */
export class PolicyOwnershipError extends Error {
  readonly policyId: string;

  constructor(action: "update" | "delete", policyId: string) {
    super(`FamilyFi will not ${action} UniFi policy ${policyId}: it has no record of creating it on this console and site.`);
    this.name = "PolicyOwnershipError";
    this.policyId = policyId;
  }
}
