/**
 * `next`, reusing `previous`'s objects and arrays wherever their content is the same, so a
 * refresh that brings nothing new hands React the references it already has. For parsed
 * JSON: plain objects, arrays and primitives.
 */
export function shareUnchanged<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (Array.isArray(previous) && Array.isArray(next)) {
    let same = previous.length === next.length;
    const shared = next.map((item, index) => {
      const kept = index < previous.length ? shareUnchanged(previous[index], item) : item;
      if (kept !== previous[index]) same = false;
      return kept;
    });
    return (same ? previous : shared) as T;
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(previous).length;
    const shared: Record<string, unknown> = {};
    for (const key of keys) {
      const kept = key in previous ? shareUnchanged(previous[key], next[key]) : next[key];
      if (!(key in previous) || kept !== previous[key]) same = false;
      shared[key] = kept;
    }
    return (same ? previous : shared) as T;
  }
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
