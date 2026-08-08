// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PiModelService } from "@story-forge/agent";
import { hasProviderIcon } from "../utils/provider-icons";

describe("provider icons", () => {
  it("maps every current PI provider to a Lobe icon", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-provider-icons-"));
    try {
      const providers = await new PiModelService({ rootDir }).list();
      const missing = providers
        .map((provider) => provider.providerId)
        .filter((providerId) => !hasProviderIcon(providerId));

      expect(missing).toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
