import { ApiError, jsonError, ResponseRefusal } from "@/server/http";

/**
 * Calls a `src/server` function and gives back what its route answers with: the result as JSON
 * with `status`, or the refusal it threw. Cases written against a response keep their assertions
 * while calling the function with plain arguments. Anything else it throws is the test's failure.
 */
export async function answered(work: () => Promise<unknown>, status = 200): Promise<Response> {
  try {
    return Response.json(await work(), { status });
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error.status, error.code, error.message);
    if (error instanceof ResponseRefusal) return error.response;
    throw error;
  }
}
