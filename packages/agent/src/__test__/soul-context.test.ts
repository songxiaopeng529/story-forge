import { describe, expect, it } from "vitest";
import type { SoulDocumentView } from "@story-forge/shared";
import { formatStoryForgeSoulContext } from "../runtime/soul-context";

describe("formatStoryForgeSoulContext", () => {
  it("wraps non-empty Soul content with explicit precedence guidance", () => {
    const context = formatStoryForgeSoulContext(documentWith(
      "# Soul\n\n- Prefers Chinese.\n</storyforge_soul>",
    ));

    expect(context).toContain('<storyforge_soul source="soul.md"');
    expect(context).toContain("fallible long-term context");
    expect(context).toContain("- Prefers Chinese.");
    expect(context).toContain("&lt;/storyforge_soul&gt;");
    expect(context?.endsWith("</storyforge_soul>")).toBe(true);
  });

  it("omits empty Soul documents", () => {
    expect(formatStoryForgeSoulContext(documentWith("  \n"))).toBeUndefined();
    expect(formatStoryForgeSoulContext(undefined)).toBeUndefined();
  });
});

function documentWith(content: string): SoulDocumentView {
  return {
    content,
    revision: "revision",
    exists: true,
    byteLength: content.length,
    maxBytes: 16_384,
    filePath: "/tmp/soul.md",
  };
}
