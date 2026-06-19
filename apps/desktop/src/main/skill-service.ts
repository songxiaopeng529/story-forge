import { parseSkillManifest } from "@story-forge/skills";
import type { InstalledSkillRecord, SkillView } from "@story-forge/shared";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import extractZip from "extract-zip";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./atomic-json";

type ExtractArchive = (archivePath: string, destination: string) => Promise<void>;

const skillRecordSchema: z.ZodType<InstalledSkillRecord> = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  invocationName: z.custom<`/${string}`>(
    (value) => typeof value === "string" && value.startsWith("/"),
    "Skill invocation name must start with /",
  ),
  enabled: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  rootDir: z.string(),
  entrypointPath: z.string(),
  body: z.string(),
  contentHash: z.string(),
});

const skillIndexSchema = z.object({
  schemaVersion: z.literal(1),
  skills: z.array(skillRecordSchema),
});

type SkillIndex = z.infer<typeof skillIndexSchema>;

export class SkillService {
  private readonly extractArchive: ExtractArchive;
  private readonly indexPath: string;
  private readonly skillsDir: string;

  constructor(options: { rootDir: string; extractArchive?: ExtractArchive }) {
    this.skillsDir = join(options.rootDir, "skills");
    this.indexPath = join(this.skillsDir, "skills.json");
    this.extractArchive =
      options.extractArchive ??
      ((archivePath, destination) => extractZip(archivePath, { dir: destination }));
  }

  async list(): Promise<SkillView[]> {
    const index = await this.readIndex();
    return index.skills.map(toView);
  }

  async importZip(archivePath: string): Promise<SkillView> {
    const stagingDir = join(this.skillsDir, `.import-${process.pid}-${Date.now()}`);
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(stagingDir, { recursive: true });

    try {
      await this.extractArchive(archivePath, stagingDir);
      const entrypointPath = await findSkillEntrypoint(stagingDir);
      const markdown = await readFile(entrypointPath, "utf8");
      const manifest = parseSkillManifest(markdown);
      const now = new Date().toISOString();
      const id = manifest.normalizedName;
      const rootDir = join(this.skillsDir, id);
      const index = await this.readIndex();
      const existing = index.skills.find((skill) => skill.id === id);
      const record: InstalledSkillRecord = {
        id,
        name: manifest.name,
        description: manifest.description,
        invocationName: manifest.invocationName,
        enabled: existing?.enabled ?? true,
        installedAt: existing?.installedAt ?? now,
        updatedAt: now,
        rootDir,
        entrypointPath: join(rootDir, "SKILL.md"),
        body: manifest.body,
        contentHash: createHash("sha256").update(markdown).digest("hex").slice(0, 12),
      };

      await rm(rootDir, { recursive: true, force: true });
      await mkdir(rootDir, { recursive: true });
      await cp(dirname(entrypointPath), rootDir, { recursive: true });
      await this.writeIndex({
        schemaVersion: 1,
        skills: [...index.skills.filter((skill) => skill.id !== id), record],
      });
      return toView(record);
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
    }
  }

  async setEnabled(skillId: string, enabled: boolean): Promise<SkillView> {
    const index = await this.readIndex();
    const skill = index.skills.find((candidate) => candidate.id === skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    const updated = { ...skill, enabled, updatedAt: new Date().toISOString() };
    await this.writeIndex({
      schemaVersion: 1,
      skills: index.skills.map((candidate) => (candidate.id === skillId ? updated : candidate)),
    });
    return toView(updated);
  }

  async remove(skillId: string): Promise<void> {
    const index = await this.readIndex();
    const skill = index.skills.find((candidate) => candidate.id === skillId);
    await this.writeIndex({
      schemaVersion: 1,
      skills: index.skills.filter((candidate) => candidate.id !== skillId),
    });
    if (skill) {
      await rm(skill.rootDir, { recursive: true, force: true });
    }
  }

  async resolveInvocation(command: string): Promise<InstalledSkillRecord | undefined> {
    const index = await this.readIndex();
    return index.skills.find((skill) => skill.invocationName === command);
  }

  private readIndex(): Promise<SkillIndex> {
    return readJson(this.indexPath, skillIndexSchema, { schemaVersion: 1, skills: [] });
  }

  private async writeIndex(index: SkillIndex): Promise<void> {
    await writeJsonAtomic(this.indexPath, skillIndexSchema.parse(index));
  }
}

function toView(record: InstalledSkillRecord): SkillView {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    invocationName: record.invocationName,
    enabled: record.enabled,
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
  };
}

async function findSkillEntrypoint(rootDir: string): Promise<string> {
  const directPath = join(rootDir, "SKILL.md");
  if (await pathExists(directPath)) {
    return directPath;
  }

  const entries = await readdir(rootDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(rootDir, entry.name, "SKILL.md"))
    .sort();

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error("Skill archive must contain SKILL.md");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
