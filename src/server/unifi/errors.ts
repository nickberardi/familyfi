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

/**
 * Saving a different console or site could not remove FamilyFi's policies from the one it is
 * leaving. Nothing was saved; the operator may save again choosing to forget that one.
 */
export class PreviousTargetError extends UnifiConfigError {
  constructor() {
    super(
      "FamilyFi couldn't reach the old gateway to remove its rules from it, so the connection was left unchanged. Forget the old gateway to switch anyway; any FamilyFi rules still on it stay there.",
    );
    this.name = "PreviousTargetError";
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
