import { describe, expect, it } from "vitest";
import { normalizeSkillName, parseSkillManifest } from "../skill-manifest";

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
      normalizedName: "code-review",
      invocationName: "/code-review",
      description: "Review code changes",
      body: "# Code Review\n\nCheck diffs and tests.\n",
    });
  });

  it("normalizes skill names for slash invocation", () => {
    expect(normalizeSkillName("Code Review")).toBe("code-review");
    expect(normalizeSkillName("  MCP.Tools_123  ")).toBe("mcp-tools-123");
  });

  it("rejects skill names that normalize to empty", () => {
    expect(() => normalizeSkillName("!!!")).toThrow("Skill name must contain letters or numbers");
  });

  it("rejects empty skill bodies", () => {
    expect(() =>
      parseSkillManifest(`---
name: empty
description: Empty skill
---

`),
    ).toThrow("Skill manifest body must not be empty");
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
