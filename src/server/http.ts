import { NextResponse } from "next/server";
import { ConfigurationError } from "./env";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export function jsonError(status: number, code: string, message: string): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function jsonCaughtError(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ConfigurationError) {
    return jsonError(
      503,
      "misconfigured",
      `FamilyFi is missing required settings in .env. ${error.message} Fix .env and restart the server.`,
    );
  }
  return jsonError(500, "internal", "Something went wrong. Check the FamilyFi server log.");
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
}
