/**
 * Checks a route handler's response against `openapi/familyfi.v1.yaml`: the status must
 * be documented for that path and method, and a JSON body must match its schema. The
 * integration config's `openapi-responses` plugin wraps every handler in `src/app/api`
 * with `checkedHandler`, so every response any integration test receives is checked —
 * the iOS client is built from this document, and a drifted field breaks it silently.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import YAML from "yaml";

type Operation = { responses?: Record<string, ResponseDoc> };
type ResponseDoc = { $ref?: string; content?: Record<string, { schema?: unknown }> };

const SPEC_ID = "familyfi-openapi";
const spec = YAML.parse(readFileSync(path.resolve(__dirname, "../../openapi/familyfi.v1.yaml"), "utf8")) as {
  paths: Record<string, Record<string, Operation>>;
};

// OpenAPI 3.1 schemas are JSON Schema 2020-12. Not strict: the document also carries
// OpenAPI's own keywords (`example`, `discriminator`), which are not validation rules.
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, SPEC_ID);

/** A JSON Pointer segment, as `$ref` spells `/` and `~` inside a key. */
const pointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

function lookup(ref: string): ResponseDoc {
  return ref
    .replace(/^#\//, "")
    .split("/")
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key.replace(/~1/g, "/").replace(/~0/g, "~")], spec) as ResponseDoc;
}

export async function assertDocumentedResponse(method: string, pathTemplate: string, response: Response): Promise<void> {
  const where = `${method} ${pathTemplate} → ${response.status}`;
  const operation = spec.paths[pathTemplate]?.[method.toLowerCase()];
  if (!operation) throw new Error(`${method} ${pathTemplate} is not in the OpenAPI document.`);
  const key = String(response.status) in (operation.responses ?? {}) ? String(response.status) : "default";
  const documented = operation.responses?.[key];
  if (!documented) throw new Error(`${where}: this status is not documented in the OpenAPI document.`);

  const resolved = documented.$ref ? lookup(documented.$ref) : documented;
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
  const validate = ajv.getSchema(schemaRef) ?? ajv.compile({ $ref: schemaRef });
  if (!validate(body)) {
    throw new Error(
      `${where} does not match the OpenAPI document: ${ajv.errorsText(validate.errors, { separator: "; " })}\n` +
        `body: ${JSON.stringify(body).slice(0, 500)}`,
    );
  }
}

/** A route handler that checks each response it returns before handing it back. */
export function checkedHandler<Args extends unknown[]>(
  method: string,
  pathTemplate: string,
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    const response = await handler(...args);
    await assertDocumentedResponse(method, pathTemplate, response);
    return response;
  };
}
