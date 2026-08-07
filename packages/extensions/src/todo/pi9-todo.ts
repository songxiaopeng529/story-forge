import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export const PI_TODO_TOOL_NAME = "todo";

export function resolvePiTodoExtensionPath(): string {
  const packagePath = require.resolve("@pi9/todo/package.json");
  return join(dirname(packagePath), "src", "index.ts");
}
