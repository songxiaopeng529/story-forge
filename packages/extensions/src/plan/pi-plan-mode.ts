import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export function resolvePiPlanModeExtensionPath(): string {
  const packagePath = require.resolve("@narumitw/pi-plan-mode/package.json");
  return join(dirname(packagePath), "src", "index.ts");
}
