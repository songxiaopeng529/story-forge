/**
 * Clamp an integer-ish value to the inclusive [min, max] range, falling back to
 * `fallback` when the input is not a finite integer.
 */
export function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}
