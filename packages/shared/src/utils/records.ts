/**
 * Coerce an unknown value into a `Record<string, unknown>`.
 * Returns an empty object for non-record values (null, arrays, primitives),
 * so that downstream property access is safe without additional casts.
 */
export function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * Type guard that returns `true` when `value` is a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
