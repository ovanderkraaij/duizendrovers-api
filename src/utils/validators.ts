export function parseNumber(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], d: T): T {
  return (typeof v === "string" && (allowed as readonly string[]).includes(v)) ? v as T : d;
}
