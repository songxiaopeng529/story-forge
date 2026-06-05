export type SkillManifest = {
  name: string;
  description: string;
  body: string;
};

export function parseSkillManifest(markdown: string): SkillManifest {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Skill manifest requires frontmatter");
  }

  const [, frontmatter = "", body = ""] = match;

  return {
    name: readFrontmatterValue(frontmatter, "name"),
    description: readFrontmatterValue(frontmatter, "description"),
    body: body.replace(/^\n/, ""),
  };
}

function readFrontmatterValue(frontmatter: string, key: string): string {
  const line = frontmatter.split("\n").find((candidate) => candidate.startsWith(`${key}:`));
  if (!line) {
    throw new Error(`Skill manifest missing ${key}`);
  }

  const value = line.slice(key.length + 1).trim();
  if (!value) {
    throw new Error(`Skill manifest missing ${key}`);
  }

  return value;
}
