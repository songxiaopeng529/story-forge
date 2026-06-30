// @vitest-environment node

import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import electronViteConfig from "../../../electron.vite.config";
import packageJson from "../../../package.json";
import rootPackageJson from "../../../../../package.json";

describe("desktop entry configuration", () => {
  it("points Electron at the main process build output", () => {
    const sourceEntry = "src/main/main.ts";
    const outputName = `${basename(sourceEntry, extname(sourceEntry))}.js`;

    expect(packageJson.main).toBe(`./out/main/${outputName}`);
  });

  it("allows pnpm to install the Electron binary", () => {
    const workspaceConfig = readFileSync(resolve(process.cwd(), "../../pnpm-workspace.yaml"), "utf8");

    expect(workspaceConfig).toMatch(/onlyBuiltDependencies:\s+(?:-\s+\S+\s+)*-\s+electron(?:\s|$)/);
  });

  it("builds a sandbox-compatible CommonJS preload script", () => {
    const config = electronViteConfig as {
      preload?: {
        build?: {
          rollupOptions?: {
            output?: unknown;
          };
        };
      };
    };
    const mainSource = readFileSync(resolve(process.cwd(), "src/main/main.ts"), "utf8");

    expect(config.preload?.build?.rollupOptions?.output).toMatchObject({
      format: "cjs",
      entryFileNames: "index.cjs",
    });
    expect(mainSource).toContain("../preload/index.cjs");
  });

  it("builds workspace dependencies before starting desktop development", () => {
    expect(rootPackageJson.scripts.predev).toBe(
      "corepack pnpm --filter '@story-forge/desktop^...' build",
    );
    expect(rootPackageJson.scripts.dev).toBe(
      "corepack pnpm --filter @story-forge/desktop dev",
    );
  });
});
