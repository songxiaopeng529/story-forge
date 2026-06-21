// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDotEnvFile } from "./env-loader";

const tempDirs: string[] = [];

afterEach(async () => {
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
