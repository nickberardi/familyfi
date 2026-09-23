import path from "node:path";
import type { Plugin } from "vitest/config";

const HANDLER = /export async function (GET|POST|PUT|PATCH|DELETE)\b/g;
const OTHER_HANDLER_EXPORT = /export\s+(?:const|let|var|function)\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE)\b[^}]*\}/;

/**
 * Wraps every exported handler in `src/app/api/**\/route.ts` with `checkedHandler`, so
 * each response an integration test receives is checked against the OpenAPI document
 * without the test doing anything. The OpenAPI path comes from the file path, the same
 * way `scripts/check-openapi.mjs` derives it.
 */
export function openapiResponses(repoRoot: string): Plugin {
  const apiRoot = path.join(repoRoot, "src/app");
  const helper = path.join(repoRoot, "tests/helpers/openapi-responses.ts");
  return {
    name: "openapi-responses",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0];
      if (!file.startsWith(path.join(apiRoot, "api") + path.sep) || !file.endsWith(`${path.sep}route.ts`)) return;
      const template = `/${path.relative(apiRoot, path.dirname(file)).split(path.sep).join("/").replace(/\[([^\]]+)\]/g, "{$1}")}`;
      const methods: string[] = [];
      const renamed = code.replace(HANDLER, (_match, method: string) => {
        methods.push(method);
        return `async function unchecked${method}`;
      });
      // Any other way of exporting a handler would slip past the check unwrapped.
      if (OTHER_HANDLER_EXPORT.test(renamed)) {
        throw new Error(`${path.relative(repoRoot, file)} exports a handler without "export async function"; openapi-responses cannot check it.`);
      }
      const exports = methods.map(
        (method) => `export const ${method} = checkedHandler("${method}", "${template}", unchecked${method});`,
      );
      return { code: `import { checkedHandler } from ${JSON.stringify(helper)};\n${renamed}\n${exports.join("\n")}\n`, map: null };
    },
  };
}
