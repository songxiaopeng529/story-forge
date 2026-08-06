import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { resolvePiPlanModeExtensionPath } from "../../../extensions/src/plan/pi-plan-mode";

describe("PI Plan Mode integration", () => {
  it("loads the package as a PI extension with its command and tools", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "storyforge-plan-mode-"));
    try {
      const loader = new DefaultResourceLoader({
        cwd: rootDir,
        agentDir: rootDir,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        additionalExtensionPaths: [resolvePiPlanModeExtensionPath()],
      });

      await loader.reload();
      const loaded = loader.getExtensions();
      const planMode = loaded.extensions.find((extension) =>
        extension.commands.has("plan")
      );

      expect(loaded.errors).toEqual([]);
      expect(planMode).toBeDefined();
      expect(planMode?.tools.has("plan_mode_question")).toBe(true);
      expect(planMode?.tools.has("plan_mode_complete")).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
