import { ApiError } from "@/server/http";

/** The status and code a `src/server` function refuses with: what its route would answer. */
export async function refusal(work: Promise<unknown>): Promise<[number, string]> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiError) return [error.status, error.code];
    throw error;
  }
  throw new Error("Expected a refusal, and the call succeeded.");
}
