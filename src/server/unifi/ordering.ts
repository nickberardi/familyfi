import type { PolicyOrdering } from "./types";

export function orderedPolicyIds(ordering: PolicyOrdering): string[] {
  return [...ordering.beforeSystemDefined, ...ordering.afterSystemDefined];
}

/** True when every previously observed id still appears in the same relative order. */
export function relativeOrderPreserved(before: string[], after: string[]): boolean {
  let index = 0;
  for (const id of before) {
    const found = after.indexOf(id, index);
    if (found === -1) return false;
    index = found + 1;
  }
  return true;
}

export function idsMissing(before: string[], after: string[]): string[] {
  const present = new Set(after);
  return before.filter((id) => !present.has(id));
}
