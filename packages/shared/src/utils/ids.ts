/**
 * Create a StoryForge-branded identifier using a short timestamp + random suffix
 * encoded in base36. The resulting id has the form `sf_<prefix>_<entropy>` and
 * is suitable for in-process use (collision-safe within a single user session).
 */
export function createId(prefix: string): string {
  const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `sf_${prefix}_${entropy}`;
}
