/**
 * Normalize an unknown caught value into a human-readable string message.
 * Returns the `message` property of `Error` instances and `String(value)` otherwise.
 */
export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
