import { describe, expect, it } from "vitest";
import { serializeStoryForgeContextDocument } from "../storyforge-context-document";

describe("serializeStoryForgeContextDocument", () => {
  it("renders ordered XML sections and escapes markdown content", () => {
    const xml = serializeStoryForgeContextDocument({
      version: 1,
      main: {
        content: "Use <workspace> safely & inspect first.",
      },
      skills: {
        available: [{
          invocationName: "/review",
          name: "Review",
          description: "Review <diff> & tests",
        }],
        active: {
          invocationName: "/review",
          name: "Review",
          description: "Review <diff> & tests",
          argumentsText: "auth <flow>",
          body: "Check `a < b && c > d`.",
        },
      },
      runtime: {
        content: "Current runtime date/time: Monday, June 22, 2026.",
      },
      mcp: {
        servers: [],
        warnings: [],
      },
      projectInfo: {
        sources: [{
          path: "/repo/AGENTS.md",
          scope: "project",
          content: "Run `pnpm test` before PRs & commits.",
          truncated: false,
          byteCount: 39,
        }],
        warnings: [],
      },
      soul: {
        status: "empty",
        sources: [],
        content: "No long-term memory has been recorded yet.",
        warnings: [],
      },
    });

    expect(xml).toContain("<storyforge-context version=\"1\">");
    expect(xml.indexOf("<main>")).toBeLessThan(xml.indexOf("<skills"));
    expect(xml.indexOf("<skills")).toBeLessThan(xml.indexOf("<runtime"));
    expect(xml.indexOf("<runtime")).toBeLessThan(xml.indexOf("<mcp"));
    expect(xml.indexOf("<mcp")).toBeLessThan(xml.indexOf("<project-info"));
    expect(xml.indexOf("<project-info")).toBeLessThan(xml.indexOf("<soul"));
    expect(xml).toContain("Use &lt;workspace&gt; safely &amp; inspect first.");
    expect(xml).toContain("<skill invocation=\"/review\" name=\"Review\">");
    expect(xml).toContain("Review &lt;diff&gt; &amp; tests");
    expect(xml).toContain("<active-skill invocation=\"/review\" name=\"Review\">");
    expect(xml).toContain("auth &lt;flow&gt;");
    expect(xml).toContain("a &lt; b &amp;&amp; c &gt; d");
    expect(xml).toContain("<runtime>");
    expect(xml).toContain("Current runtime date/time: Monday, June 22, 2026.");
    expect(xml).toContain("<mcp server-count=\"0\" tool-count=\"0\">");
    expect(xml).toContain("<project-info source-count=\"1\">");
    expect(xml).toContain("<source path=\"/repo/AGENTS.md\" scope=\"project\" truncated=\"false\"");
    expect(xml).toContain("<soul source-count=\"0\" status=\"empty\">");
  });

  it("renders MCP servers, tools, and warnings", () => {
    const xml = serializeStoryForgeContextDocument({
      version: 1,
      main: { content: "Main" },
      skills: { available: [] },
      runtime: { content: "Current runtime date/time: Monday, June 22, 2026." },
      mcp: {
        servers: [{
          name: "github",
          transport: "stdio",
          status: "available",
          instructions: "Use read-only tools first.",
          tools: [{
            name: "list_issues",
            description: "List <issues>",
            inputSchemaSummary: "owner, repo",
          }],
        }],
        warnings: ["Server <slow>"],
      },
      projectInfo: { sources: [], warnings: [] },
      soul: {
        status: "empty",
        sources: [],
        content: "No long-term memory has been recorded yet.",
        warnings: [],
      },
    });

    expect(xml).toContain("<mcp server-count=\"1\" tool-count=\"1\">");
    expect(xml).toContain("<server name=\"github\" transport=\"stdio\" status=\"available\">");
    expect(xml).toContain("Use read-only tools first.");
    expect(xml).toContain("<tool name=\"list_issues\" input-schema=\"owner, repo\">");
    expect(xml).toContain("List &lt;issues&gt;");
    expect(xml).toContain("<warning>Server &lt;slow&gt;</warning>");
  });
});
