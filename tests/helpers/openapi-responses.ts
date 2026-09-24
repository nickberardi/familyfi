/**
 * Checks a route handler's request and response against `openapi/familyfi.v1.yaml`. The
 * request's JSON body must match the operation's `requestBody` schema and its path and
 * query parameters its `parameters`; the response status must be documented for that
 * path and method, and a JSON body must match its schema. The integration config's
 * `openapi-responses` plugin wraps every handler in `src/app/api` with `checkedHandler`,
 * so every request an integration test sends and every response it receives is checked —
 * the iOS client is built from this document, and a drifted field breaks it silently.
 *
 * A negative-path test that sends what the document forbids, to check the handler
 * rejects it, wraps that one request in `invalidRequest`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import YAML from "yaml";

type Operation = {
  parameters?: ParameterDoc[];
  requestBody?: RequestBodyDoc;
  responses?: Record<string, ResponseDoc>;
};
type ParameterDoc = { $ref?: string; name: string; in: "path" | "query" | "header" | "cookie"; required?: boolean; schema?: unknown };
type RequestBodyDoc = { $ref?: string; required?: boolean; content?: Record<string, { schema?: unknown }> };
type ResponseDoc = { $ref?: string; content?: Record<string, { schema?: unknown }> };

const SPEC_ID = "familyfi-openapi";
const spec = YAML.parse(readFileSync(path.resolve(__dirname, "../../openapi/familyfi.v1.yaml"), "utf8")) as {
  paths: Record<string, Record<string, Operation> & { parameters?: ParameterDoc[] }>;
};

// OpenAPI 3.1 schemas are JSON Schema 2020-12. Not strict: the document also carries
// OpenAPI's own keywords (`example`, `discriminator`), which are not validation rules.
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, SPEC_ID);

/** A JSON Pointer segment, as `$ref` spells `/` and `~` inside a key. */
const pointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

function lookup<T>(ref: string): T {
  return ref
    .replace(/^#\//, "")
    .split("/")
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key.replace(/~1/g, "/").replace(/~0/g, "~")], spec) as T;
}

function validator(schemaRef: string) {
  return ajv.getSchema(schemaRef) ?? ajv.compile({ $ref: schemaRef });
}

function operationFor(method: string, pathTemplate: string): Operation {
  const operation = spec.paths[pathTemplate]?.[method.toLowerCase()];
  if (!operation) throw new Error(`${method} ${pathTemplate} is not in the OpenAPI document.`);
  return operation;
}

/**
 * What a route handler receives: the request, and for a dynamic route its params. A
 * handler that takes no arguments, such as a public GET, is called with no request.
 */
export type RequestParts = { request?: Request; params?: Record<string, string | string[]> };

/**
 * Every way a request breaks the document for its operation, or none. Header and cookie
 * parameters are left to the handlers' own auth tests: a test that checks a missing CSRF
 * token or session sends one on purpose.
 */
export async function requestProblems(method: string, pathTemplate: string, { request, params = {} }: RequestParts): Promise<string[]> {
  const operation = operationFor(method, pathTemplate);
  const base = `${SPEC_ID}#/paths/${pointer(pathTemplate)}`;
  const problems: string[] = [];

  // Parameters are declared on the path item, the operation, or both; the operation wins.
  const declared = new Map<string, { doc: ParameterDoc; schemaRef: string }>();
  const collect = (list: ParameterDoc[] | undefined, at: string) =>
    list?.forEach((entry, index) => {
      const doc = entry.$ref ? lookup<ParameterDoc>(entry.$ref) : entry;
      const schemaRef = entry.$ref ? `${SPEC_ID}${entry.$ref}/schema` : `${at}/parameters/${index}/schema`;
      declared.set(`${doc.in}:${doc.name}`, { doc, schemaRef });
    });
  collect(spec.paths[pathTemplate]?.parameters, base);
  collect(operation.parameters, `${base}/${method.toLowerCase()}`);

  const query = request ? new URL(request.url).searchParams : new URLSearchParams();
  for (const name of new Set(query.keys())) {
    if (!declared.has(`query:${name}`)) problems.push(`query parameter "${name}" is not documented`);
  }
  for (const { doc, schemaRef } of declared.values()) {
    if (doc.in !== "path" && doc.in !== "query") continue;
    const values = doc.in === "path" ? [params[doc.name]].flat().filter((value) => value !== undefined) : query.getAll(doc.name);
    if (values.length === 0) {
      if (doc.required) problems.push(`${doc.in} parameter "${doc.name}" is required`);
      continue;
    }
    if (!doc.schema) continue;
    const validate = validator(schemaRef);
    for (const value of values) {
      if (!validate(value)) problems.push(`${doc.in} parameter "${doc.name}": ${ajv.errorsText(validate.errors, { separator: "; " })}`);
    }
  }

  const text = request?.body ? await request.clone().text() : "";
  const body = operation.requestBody?.$ref ? lookup<RequestBodyDoc>(operation.requestBody.$ref) : operation.requestBody;
  if (!body) {
    if (text) problems.push("sends a body, but the operation documents none");
    return problems;
  }
  if (!text) {
    if (body.required) problems.push("the request body is required");
    return problems;
  }
  if (!body.content?.["application/json"]) return problems;
  const bodyRef = operation.requestBody?.$ref
    ? `${SPEC_ID}${operation.requestBody.$ref}/content/${pointer("application/json")}/schema`
    : `${base}/${method.toLowerCase()}/requestBody/content/${pointer("application/json")}/schema`;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    problems.push(`the body is not JSON: ${text.slice(0, 200)}`);
    return problems;
  }
  const validate = validator(bodyRef);
  if (!validate(value)) {
    problems.push(`${ajv.errorsText(validate.errors, { separator: "; ", dataVar: "body" })}; body: ${JSON.stringify(value).slice(0, 500)}`);
  }
  return problems;
}

const knownInvalid = new WeakSet<Request>();

/**
 * Marks a request a negative-path test sends on purpose against the document, so the
 * handler still sees it. The request must in fact break the document, and the handler
 * must refuse it with a 4xx; a marked request that passes either check fails the test,
 * so the opt-out never outlives the reason for it.
 */
export function invalidRequest<R extends Request>(request: R): R {
  knownInvalid.add(request);
  return request;
}

export async function assertDocumentedRequest(method: string, pathTemplate: string, parts: RequestParts): Promise<void> {
  const problems = await requestProblems(method, pathTemplate, parts);
  const marked = parts.request !== undefined && knownInvalid.has(parts.request);
  if (marked && problems.length === 0) {
    throw new Error(`${method} ${pathTemplate}: the request is marked invalidRequest but matches the OpenAPI document; drop the marker.`);
  }
  if (!marked && problems.length > 0) {
    throw new Error(`${method} ${pathTemplate} request does not match the OpenAPI document: ${problems.join("; ")}`);
  }
}

export async function assertDocumentedResponse(method: string, pathTemplate: string, response: Response): Promise<void> {
  const where = `${method} ${pathTemplate} → ${response.status}`;
  const operation = operationFor(method, pathTemplate);
  const key = String(response.status) in (operation.responses ?? {}) ? String(response.status) : "default";
  const documented = operation.responses?.[key];
  if (!documented) throw new Error(`${where}: this status is not documented in the OpenAPI document.`);

  const resolved = documented.$ref ? lookup<ResponseDoc>(documented.$ref) : documented;
  if (!resolved.content?.["application/json"]?.schema) return;
  const schemaRef = documented.$ref
    ? `${SPEC_ID}${documented.$ref}/content/${pointer("application/json")}/schema`
    : `${SPEC_ID}#/paths/${pointer(pathTemplate)}/${method.toLowerCase()}/responses/${key}/content/${pointer("application/json")}/schema`;

  const text = await response.clone().text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${where}: documented as JSON, but the body is not JSON: ${text.slice(0, 200)}`);
  }
  const validate = validator(schemaRef);
  if (!validate(body)) {
    throw new Error(
      `${where} does not match the OpenAPI document: ${ajv.errorsText(validate.errors, { separator: "; " })}\n` +
        `body: ${JSON.stringify(body).slice(0, 500)}`,
    );
  }
}

/**
 * A route handler that checks each request against the document before handling it, and
 * each response it returns before handing it back.
 */
export function checkedHandler<Args extends unknown[]>(
  method: string,
  pathTemplate: string,
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    const [request, context] = args as unknown as [Request | undefined, { params?: Promise<RequestParts["params"]> } | undefined];
    await assertDocumentedRequest(method, pathTemplate, { request, params: await context?.params });
    const response = await handler(...args);
    if (request && knownInvalid.has(request) && (response.status < 400 || response.status >= 500)) {
      throw new Error(`${method} ${pathTemplate}: the request is marked invalidRequest, but the handler answered ${response.status}, not a 4xx.`);
    }
    await assertDocumentedResponse(method, pathTemplate, response);
    return response;
  };
}
