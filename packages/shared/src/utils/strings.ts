import { toRecord } from "./records";

/**
 * Read a required trimmed string field from an unknown input object.
 * Throws if the field is missing, not a string, or empty after trimming.
 */
export function readStringField(
  input: unknown,
  field: string,
  options: { label?: string } = {},
): string {
  const value = toRecord(input)[field];
  if (typeof value !== "string" || !value.trim()) {
    const label = options.label ? `${options.label} ` : "";
    throw new Error(`Expected non-empty string field: ${label}${field}`);
  }
  return value.trim();
}

/**
 * Read an optional trimmed string field from an unknown input object.
 * Returns `undefined` when the field is missing, not a string, or empty after trimming.
 */
export function readOptionalStringField(
  input: unknown,
  field: string,
): string | undefined {
  const value = toRecord(input)[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
