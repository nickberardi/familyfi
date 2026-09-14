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
