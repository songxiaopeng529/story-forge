import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolvePiPlanModeExtensionPath } from "../plan/pi-plan-mode";

describe("resolvePiPlanModeExtensionPath", () => {
  it("resolves the installed PI Plan Mode extension source", () => {
    const extensionPath = resolvePiPlanModeExtensionPath();

    expect(extensionPath).toMatch(/@narumitw\/pi-plan-mode\/src\/index\.ts$/u);
    expect(existsSync(extensionPath)).toBe(true);
  });
});
