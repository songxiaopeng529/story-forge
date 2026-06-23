export type StoryForgeContextDocument = {
  version: 1;
  main: {
    content: string;
  };
  skills: StoryForgeSkillsContext;
  runtime: StoryForgeRuntimeContext;
  mcp: StoryForgeMcpContext;
  projectInfo: StoryForgeProjectInfoContext;
  soul: StoryForgeSoulContext;
};

export type StoryForgeRuntimeContext = {
  content: string;
};

export type StoryForgeSkillsContext = {
  available: StoryForgeAvailableSkill[];
  active?: StoryForgeActiveSkill | undefined;
};

export type StoryForgeAvailableSkill = {
  invocationName: `/${string}`;
  name: string;
  description: string;
};

export type StoryForgeActiveSkill = StoryForgeAvailableSkill & {
  argumentsText: string;
  body: string;
};

export type StoryForgeMcpContext = {
  servers: StoryForgeMcpServer[];
  warnings: string[];
};

export type StoryForgeMcpServer = {
  name: string;
  transport: string;
  status: "available" | "disabled" | "failed" | "untested";
  instructions?: string | undefined;
  tools: StoryForgeMcpTool[];
};

export type StoryForgeMcpTool = {
  name: string;
  description: string;
  inputSchemaSummary?: string | undefined;
};

export type StoryForgeProjectInfoContext = {
  sources: StoryForgeProjectInfoSource[];
  warnings: string[];
};

export type StoryForgeProjectInfoSource = {
  path: string;
  scope: "project";
  content: string;
  truncated: boolean;
  byteCount: number;
};

export type StoryForgeSoulContext = {
  status: "empty" | "available" | "unavailable";
  sources: StoryForgeSoulSource[];
  content: string;
  warnings: string[];
};

export type StoryForgeSoulSource = {
  title: string;
  content: string;
  updatedAt?: string | undefined;
};

export function serializeStoryForgeContextDocument(document: StoryForgeContextDocument): string {
  const toolCount = document.mcp.servers.reduce((total, server) => total + server.tools.length, 0);
  const lines = [
    `<storyforge-context version="${document.version}">`,
    "  <main>",
    indentText(escapeXml(document.main.content), 4),
    "  </main>",
    "",
    `  <skills count="${document.skills.available.length}"${document.skills.active ? ` active="${escapeAttribute(document.skills.active.invocationName)}"` : ""}>`,
    renderSkills(document.skills),
    "  </skills>",
    "",
    "  <runtime>",
    indentText(escapeXml(document.runtime.content), 4),
    "  </runtime>",
    "",
    `  <mcp server-count="${document.mcp.servers.length}" tool-count="${toolCount}">`,
    renderMcp(document.mcp),
    "  </mcp>",
    "",
    `  <project-info source-count="${document.projectInfo.sources.length}">`,
    renderProjectInfo(document.projectInfo),
    "  </project-info>",
    "",
    `  <soul source-count="${document.soul.sources.length}" status="${escapeAttribute(document.soul.status)}">`,
    renderSoul(document.soul),
    "  </soul>",
    "</storyforge-context>",
  ];
  return lines.join("\n");
}

function renderSkills(skills: StoryForgeSkillsContext): string {
  const lines = ["    <available>"];
  for (const skill of skills.available) {
    lines.push(`      <skill invocation="${escapeAttribute(skill.invocationName)}" name="${escapeAttribute(skill.name)}">`);
    lines.push(indentText(escapeXml(singleLine(skill.description)), 8));
    lines.push("      </skill>");
  }
  lines.push("    </available>");

  if (skills.active) {
    lines.push(`    <active-skill invocation="${escapeAttribute(skills.active.invocationName)}" name="${escapeAttribute(skills.active.name)}">`);
    lines.push("      <arguments>");
    lines.push(indentText(escapeXml(skills.active.argumentsText), 8));
    lines.push("      </arguments>");
    lines.push("      <instructions>");
    lines.push(indentText(escapeXml(skills.active.body), 8));
    lines.push("      </instructions>");
    lines.push("    </active-skill>");
  }

  return lines.join("\n");
}

function renderMcp(mcp: StoryForgeMcpContext): string {
  const lines: string[] = [];
  for (const server of mcp.servers) {
    lines.push(
      `    <server name="${escapeAttribute(server.name)}" transport="${escapeAttribute(server.transport)}" status="${escapeAttribute(server.status)}">`,
    );
    if (server.instructions?.trim()) {
      lines.push("      <instructions>");
      lines.push(indentText(escapeXml(server.instructions), 8));
      lines.push("      </instructions>");
    }
    for (const tool of server.tools) {
      const schemaAttribute = tool.inputSchemaSummary
        ? ` input-schema="${escapeAttribute(tool.inputSchemaSummary)}"`
        : "";
      lines.push(`      <tool name="${escapeAttribute(tool.name)}"${schemaAttribute}>`);
      lines.push(indentText(escapeXml(singleLine(tool.description)), 8));
      lines.push("      </tool>");
    }
    lines.push("    </server>");
  }
  lines.push(renderWarnings(mcp.warnings, 4));
  return lines.filter(Boolean).join("\n");
}

function renderProjectInfo(projectInfo: StoryForgeProjectInfoContext): string {
  const lines: string[] = [];
  for (const source of projectInfo.sources) {
    lines.push(
      `    <source path="${escapeAttribute(source.path)}" scope="${escapeAttribute(source.scope)}" truncated="${source.truncated ? "true" : "false"}" byte-count="${source.byteCount}">`,
    );
    lines.push(indentText(escapeXml(source.content), 6));
    lines.push("    </source>");
  }
  lines.push(renderWarnings(projectInfo.warnings, 4));
  return lines.filter(Boolean).join("\n");
}

function renderSoul(soul: StoryForgeSoulContext): string {
  const lines: string[] = [];
  for (const source of soul.sources) {
    const updatedAt = source.updatedAt ? ` updated-at="${escapeAttribute(source.updatedAt)}"` : "";
    lines.push(`    <source title="${escapeAttribute(source.title)}"${updatedAt}>`);
    lines.push(indentText(escapeXml(source.content), 6));
    lines.push("    </source>");
  }
  if (soul.content.trim()) {
    lines.push(indentText(escapeXml(soul.content), 4));
  }
  lines.push(renderWarnings(soul.warnings, 4));
  return lines.filter(Boolean).join("\n");
}

function renderWarnings(warnings: string[], spaces: number): string {
  return warnings
    .map((warning) => `${" ".repeat(spaces)}<warning>${escapeXml(warning)}</warning>`)
    .join("\n");
}

function escapeAttribute(value: string): string {
  return escapeXml(value).replace(/"/g, "&quot;");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function indentText(value: string, spaces: number): string {
  const indentation = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${indentation}${line}`)
    .join("\n");
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
