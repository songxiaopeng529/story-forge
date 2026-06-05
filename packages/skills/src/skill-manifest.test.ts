import { describe, expect, it } from "vitest";
import { parseSkillManifest } from "./skill-manifest";

describe("parseSkillManifest", () => {
  it("extracts skill metadata from markdown frontmatter", () => {
    const manifest = parseSkillManifest(`---
name: code-review
description: Review code changes
---

# Code Review

Check diffs and tests.
`);

    expect(manifest).toEqual({
      name: "code-review",
      description: "Review code changes",
      body: "# Code Review\n\nCheck diffs and tests.\n",
    });
  });

  it("rejects manifests without required frontmatter fields", () => {
    expect(() => parseSkillManifest("# Missing frontmatter")).toThrow("Skill manifest requires frontmatter");
    expect(() =>
      parseSkillManifest(`---
name: incomplete
---

Body
`),
    ).toThrow("Skill manifest missing description");
  });
});
