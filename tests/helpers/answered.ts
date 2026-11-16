import { ApiError, jsonError, ResponseRefusal } from "@/server/http";
import { assertDocumentedResponse } from "./openapi-responses";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Calls a `src/server` function and gives back the status and JSON its route answers with: the
 * result with `status`, or the refusal it threw. The caller supplies the route's envelope and
 * status; anything else the function throws is the test's failure.
 *
 * `operation` names the route the function serves, as the OpenAPI file spells it. The answer is
 * checked against that operation exactly as a handler's is: its status must be documented and its
 * body must match the schema. So a case that calls the function keeps the contract check it had
 * when it called the route.
 */
export async function answered(operation: `${Method} /api/v1/${string}`, work: () => Promise<unknown>, status = 200): Promise<Response> {
  let response: Response;
  try {
    response = Response.json(await work(), { status });
  } catch (error) {
    if (error instanceof ApiError) response = jsonError(error.status, error.code, error.message);
    else if (error instanceof ResponseRefusal) response = error.response;
    else throw error;
  }
  return documented(operation, response);
}

/** Checks an answer a case built another way, such as a body reader's refusal, against its operation. */
export async function documented(operation: `${Method} /api/v1/${string}`, response: Response): Promise<Response> {
  const space = operation.indexOf(" ");
  await assertDocumentedResponse(operation.slice(0, space), operation.slice(space + 1), response);
  return response;
}
