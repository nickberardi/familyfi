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
  console.error(error);
  if (error instanceof ConfigurationError) {
    return jsonError(
      503,
      "misconfigured",
      `FamilyFi is missing required settings in .env. ${error.message} Fix .env and restart the server.`,
    );
  }
  if (error && typeof error === "object" && "name" in error && error.name === "SchemaMismatchError") {
    return jsonError(
      500,
      "schema_mismatch",
      error instanceof Error
        ? error.message
        : "The running app is using an old database client. Restart FamilyFi after applying migrations.",
    );
  }
  if (error && typeof error === "object" && "name" in error && error.name === "PrismaClientValidationError") {
    return jsonError(
      500,
      "schema_mismatch",
      "The running app is using an old database client. Restart FamilyFi after applying migrations.",
    );
  }
  return jsonError(500, "internal", "Something went wrong. Check the FamilyFi server log.");
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
}
