// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDotEnvFile, loadStoryForgeDotEnv } from "./env-loader";

const tempDirs: string[] = [];
let originalCwd: string | undefined;

afterEach(async () => {
  if (originalCwd) {
    process.chdir(originalCwd);
    originalCwd = undefined;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadDotEnvFile", () => {
  it("loads simple dotenv values without overriding existing env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "story-forge-env-"));
    tempDirs.push(dir);
    const envPath = join(dir, ".env");
    await writeFile(
      envPath,
      "Tavily_API_KEY=from-file\nSerpApi_API_KEY=\"quoted value\"\n",
      "utf8",
    );
    const env: NodeJS.ProcessEnv = { Tavily_API_KEY: "existing" };

    await loadDotEnvFile(envPath, env);

    expect(env.Tavily_API_KEY).toBe("existing");
    expect(env.SerpApi_API_KEY).toBe("quoted value");
  });

  it("ignores missing dotenv files", async () => {
    const env: NodeJS.ProcessEnv = {};

    await loadDotEnvFile("/tmp/story-forge-missing/.env", env);

    expect(env).toEqual({});
  });
});

describe("loadStoryForgeDotEnv", () => {
  it("loads .env from the workspace root when run from a nested package cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "story-forge-root-"));
    tempDirs.push(root);
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n", "utf8");
    const key = `SF_TEST_ROOT_ENV_${Date.now()}`;
    await writeFile(join(root, ".env"), `${key}=from-root\n`, "utf8");
    const nested = join(root, "apps", "desktop");
    await mkdir(nested, { recursive: true });

    originalCwd = process.cwd();
    process.chdir(nested);
    try {
      await loadStoryForgeDotEnv(nested);
      expect(process.env[key]).toBe("from-root");
    } finally {
      delete process.env[key];
    }
  });
});
