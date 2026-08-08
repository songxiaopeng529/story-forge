import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  symlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isNodeError, writeJsonAtomic } from "./atomic-json";

export const STORYFORGE_HOME_ENV = "STORYFORGE_HOME";

const STORYFORGE_HOME_DIR_NAME = ".story-forge";
const ELECTRON_USER_DATA_MIGRATION = "electron-user-data-v1";

export type StoryForgePaths = {
  rootDir: string;
  agentDir: string;
  appSettingsPath: string;
  workspacesPath: string;
  mcpConfigPath: string;
  automationsDir: string;
  automationRunsDir: string;
  skillsDir: string;
  sessionMetadataDir: string;
  sessionTranscriptsDir: string;
  migrationsDir: string;
};

export type StoryForgeHomeMigrationResult = {
  status: "migrated" | "already-migrated" | "not-needed";
  copiedFiles: number;
  markerPath?: string;
};

export function resolveStoryForgePaths(options: {
  homeDir?: string;
  userHomeDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): StoryForgePaths {
  const userHomeDir = resolve(options.userHomeDir ?? homedir());
  const configuredHome = options.homeDir ?? (options.env ?? process.env)[STORYFORGE_HOME_ENV];
  const rootDir = configuredHome
    ? resolve(expandHome(configuredHome, userHomeDir))
    : join(userHomeDir, STORYFORGE_HOME_DIR_NAME);
  const automationsDir = join(rootDir, "automations");
  const sessionsDir = join(rootDir, "sessions");

  return {
    rootDir,
    agentDir: join(rootDir, "agent"),
    appSettingsPath: join(rootDir, "settings.json"),
    workspacesPath: join(rootDir, "workspaces.json"),
    mcpConfigPath: join(rootDir, "mcp.json"),
    automationsDir,
    automationRunsDir: join(automationsDir, "runs"),
    skillsDir: join(rootDir, "skills"),
    sessionMetadataDir: join(sessionsDir, "metadata"),
    sessionTranscriptsDir: join(sessionsDir, "transcripts"),
    migrationsDir: join(rootDir, "migrations"),
  };
}

export async function migrateLegacyStoryForgeHome(options: {
  legacyRootDir: string;
  paths: StoryForgePaths;
}): Promise<StoryForgeHomeMigrationResult> {
  const legacyRootDir = resolve(options.legacyRootDir);
  const targetRootDir = resolve(options.paths.rootDir);
  if (legacyRootDir === targetRootDir) {
    return { status: "not-needed", copiedFiles: 0 };
  }

  const markerPath = join(options.paths.migrationsDir, `${ELECTRON_USER_DATA_MIGRATION}.json`);
  if (await pathExists(markerPath)) {
    return { status: "already-migrated", copiedFiles: 0, markerPath };
  }

  await mkdir(targetRootDir, { recursive: true, mode: 0o700 });
  let copiedFiles = 0;
  for (const entry of legacyMigrationEntries(legacyRootDir, options.paths)) {
    copiedFiles += await copyMissing(entry.source, entry.destination);
  }

  await rewriteMigratedPaths({ legacyRootDir, paths: options.paths });
  await writeJsonAtomic(markerPath, {
    schemaVersion: 1,
    migration: ELECTRON_USER_DATA_MIGRATION,
    sourceRootDir: legacyRootDir,
    targetRootDir,
    migratedAt: new Date().toISOString(),
    copiedFiles,
  });

  return { status: "migrated", copiedFiles, markerPath };
}

function legacyMigrationEntries(legacyRootDir: string, paths: StoryForgePaths) {
  return [
    { source: join(legacyRootDir, "settings.json"), destination: paths.appSettingsPath },
    { source: join(legacyRootDir, "workspaces.json"), destination: paths.workspacesPath },
    { source: join(legacyRootDir, "mcp.json"), destination: paths.mcpConfigPath },
    { source: join(legacyRootDir, "providers.json"), destination: join(paths.rootDir, "providers.json") },
    { source: join(legacyRootDir, "secrets.json"), destination: join(paths.rootDir, "secrets.json") },
    { source: join(legacyRootDir, "automations"), destination: paths.automationsDir },
    { source: join(legacyRootDir, "skills"), destination: paths.skillsDir },
    { source: join(legacyRootDir, "sessions"), destination: paths.sessionMetadataDir },
    { source: join(legacyRootDir, "pi-sessions"), destination: paths.sessionTranscriptsDir },
    { source: join(legacyRootDir, "pi-agent"), destination: paths.agentDir },
    { source: join(legacyRootDir, "migrations"), destination: paths.migrationsDir },
  ];
}

async function copyMissing(source: string, destination: string): Promise<number> {
  let sourceStat;
  try {
    sourceStat = await lstat(source);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return 0;
    }
    throw error;
  }

  if (sourceStat.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: sourceStat.mode });
    const entries = await readdir(source, { withFileTypes: true });
    let copiedFiles = 0;
    for (const entry of entries) {
      copiedFiles += await copyMissing(
        join(source, entry.name),
        join(destination, entry.name),
      );
    }
    return copiedFiles;
  }

  await mkdir(dirname(destination), { recursive: true });
  if (sourceStat.isSymbolicLink()) {
    try {
      await symlink(await readlink(source), destination);
      return 1;
    } catch (error) {
      if (isNodeError(error, "EEXIST")) {
        return 0;
      }
      throw error;
    }
  }

  try {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    await chmod(destination, sourceStat.mode);
    return 1;
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      return 0;
    }
    throw error;
  }
}

async function rewriteMigratedPaths(options: {
  legacyRootDir: string;
  paths: StoryForgePaths;
}): Promise<void> {
  const mappings = [
    {
      source: join(options.legacyRootDir, "pi-sessions"),
      destination: options.paths.sessionTranscriptsDir,
    },
    {
      source: join(options.legacyRootDir, "pi-agent"),
      destination: options.paths.agentDir,
    },
    {
      source: join(options.legacyRootDir, "skills"),
      destination: options.paths.skillsDir,
    },
    { source: options.legacyRootDir, destination: options.paths.rootDir },
  ];

  await rewriteJsonFilesInDirectory(options.paths.sessionMetadataDir, mappings);
  await Promise.all([
    rewriteJsonAbsolutePaths(join(options.paths.skillsDir, "skills.json"), mappings),
    rewriteJsonAbsolutePaths(join(options.paths.agentDir, "settings.json"), mappings),
    rewriteJsonAbsolutePaths(options.paths.mcpConfigPath, mappings),
  ]);
}

async function rewriteJsonFilesInDirectory(
  directory: string,
  mappings: Array<{ source: string; destination: string }>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => rewriteJsonAbsolutePaths(join(directory, entry.name), mappings)),
  );
}

async function rewriteJsonAbsolutePaths(
  filePath: string,
  mappings: Array<{ source: string; destination: string }>,
): Promise<void> {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Cannot migrate invalid JSON file: ${filePath}`, { cause: error });
  }
  const rewritten = rewriteValue(parsed, mappings);
  if (rewritten.changed) {
    await writeJsonAtomic(filePath, rewritten.value);
  }
}

function rewriteValue(
  value: unknown,
  mappings: Array<{ source: string; destination: string }>,
): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const rewritten = rewriteAbsolutePath(value, mappings);
    return { value: rewritten, changed: rewritten !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const rewritten = value.map((entry) => {
      const result = rewriteValue(entry, mappings);
      changed ||= result.changed;
      return result.value;
    });
    return { value: rewritten, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const rewritten = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        const result = rewriteValue(entry, mappings);
        changed ||= result.changed;
        return [key, result.value];
      }),
    );
    return { value: rewritten, changed };
  }
  return { value, changed: false };
}

function rewriteAbsolutePath(
  value: string,
  mappings: Array<{ source: string; destination: string }>,
): string {
  if (!isAbsolute(value)) {
    return value;
  }
  for (const mapping of mappings) {
    const suffix = relative(mapping.source, value);
    if (suffix === "" || (!suffix.startsWith("..") && !isAbsolute(suffix))) {
      return suffix ? join(mapping.destination, suffix) : mapping.destination;
    }
  }
  return value;
}

function expandHome(value: string, userHomeDir: string): string {
  if (value === "~") {
    return userHomeDir;
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(userHomeDir, value.slice(2));
  }
  return value;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}
