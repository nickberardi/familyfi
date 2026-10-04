import type { PolicyOrdering } from "./types";

export function orderedPolicyIds(ordering: PolicyOrdering): string[] {
  return [...ordering.beforeSystemDefined, ...ordering.afterSystemDefined];
}

export function idsMissing(before: string[], after: string[]): string[] {
  const present = new Set(after);
  return before.filter((id) => !present.has(id));
}
