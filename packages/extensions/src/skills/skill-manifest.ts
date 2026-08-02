export type SkillManifest = {
  name: string;
  normalizedName: string;
  invocationName: `/${string}`;
  description: string;
  body: string;
};

export function parseSkillManifest(markdown: string): SkillManifest {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Skill manifest requires frontmatter");
  }

  const [, frontmatter = "", body = ""] = match;
  const name = readFrontmatterValue(frontmatter, "name");
  const normalizedName = normalizeSkillName(name);
  const trimmedBody = body.replace(/^\n/, "");
  if (!trimmedBody.trim()) {
    throw new Error("Skill manifest body must not be empty");
  }

  return {
    name,
    normalizedName,
    invocationName: `/${normalizedName}`,
    description: readFrontmatterValue(frontmatter, "description"),
    body: trimmedBody,
  };
}

export function normalizeSkillName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    throw new Error("Skill name must contain letters or numbers");
  }
  return normalized;
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
