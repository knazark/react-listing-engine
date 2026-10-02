// Structural equality over plain data (primitives, arrays, plain objects).
// Anything else -- a Date, a class instance, a function -- is equal only to
// itself, so an item this cannot vouch for is never treated as unchanged.
export function plainEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => plainEqual(value, b[index]));
  }
  const proto = Object.getPrototypeOf(a) as unknown;
  if (proto !== Object.getPrototypeOf(b) || (proto !== Object.prototype && proto !== null)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    key => Object.hasOwn(b, key) && plainEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
