import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_SEARCH_RESULTS = 20;
const MAX_SEARCH_RESULTS = 100;
const IGNORED_SEARCH_DIRECTORIES = new Set([".git", "node_modules"]);

export type WorkspaceSearchMatch = {
  path: string;
  line: number;
  snippet: string;
};

export type WorkspaceSearchResult = {
  query: string;
  matches: WorkspaceSearchMatch[];
  truncated: boolean;
};

export class WorkspaceSandbox {
  private readonly workspaceRoot: string;
  private readonly maxFileBytes: number;
  private workspaceRootRealpath: string | undefined;

  constructor(workspaceRoot: string, options: { maxFileBytes?: number } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  async readTextFile(filePath: string): Promise<string> {
    const resolvedPath = await this.resolveExistingPath(filePath);
    const fileStat = await stat(resolvedPath);
    this.assertFileSize(fileStat.size);
    return readFile(resolvedPath, "utf8");
  }

  async listDirectory(directoryPath = "."): Promise<string[]> {
    const resolvedPath = await this.resolveExistingPath(directoryPath);
    return readdir(resolvedPath);
  }

  async searchText(input: {
    query: string;
    path?: string;
    maxResults?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSearchResult> {
    const query = input.query.trim();
    if (!query) {
      throw new Error("workspace.searchText requires a non-empty query");
    }

    const maxResults = clampSearchResults(input.maxResults);
    const startPath = await this.resolveExistingPath(input.path ?? ".");
    const rootRealpath = await this.getWorkspaceRootRealpath();
    const matches: WorkspaceSearchMatch[] = [];
    let truncated = false;

    const visitFile = async (filePath: string): Promise<void> => {
      throwIfAborted(input.signal);
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }
      const fileStat = await stat(filePath);
      this.assertFileSize(fileStat.size);
      const buffer = await readFile(filePath);
      if (buffer.includes(0)) {
        return;
      }
      const relativePath = normalizeRelativePath(path.relative(rootRealpath, filePath));
      const lines = buffer.toString("utf8").split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (!line.includes(query)) {
          continue;
        }
        if (matches.length >= maxResults) {
          truncated = true;
          return;
        }
        matches.push({
          path: relativePath,
          line: index + 1,
          snippet: line.trim(),
        });
      }
    };

    const visitPath = async (candidatePath: string): Promise<void> => {
      throwIfAborted(input.signal);
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }
      const entryStat = await stat(candidatePath);
      if (entryStat.isFile()) {
        await visitFile(candidatePath);
        return;
      }
      if (!entryStat.isDirectory()) {
        return;
      }
      const entries = (await readdir(candidatePath, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.isDirectory() && IGNORED_SEARCH_DIRECTORIES.has(entry.name)) {
          continue;
        }
        await visitPath(path.join(candidatePath, entry.name));
        if (matches.length >= maxResults) {
          truncated = true;
          return;
        }
      }
    };

    await visitPath(startPath);
    return { query, matches, truncated };
  }

  async writeTextFile(filePath: string, content: string): Promise<{ path: string; bytes: number }> {
    const bytes = Buffer.byteLength(content);
    this.assertFileSize(bytes);
    const resolvedPath = await this.resolveWritablePath(filePath);
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    const temporaryPath = `${resolvedPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, resolvedPath);
    return { path: filePath, bytes };
  }

  async replaceText(
    filePath: string,
    oldText: string,
    newText: string,
    options: { replaceAll?: boolean } = {},
  ): Promise<{ path: string; replacements: number }> {
    if (!oldText) {
      throw new Error("Text to replace must not be empty");
    }
    const content = await this.readTextFile(filePath);
    const replacements = countOccurrences(content, oldText);
    if (replacements === 0) {
      throw new Error(`Text to replace was not found in ${filePath}`);
    }
    const updated = options.replaceAll
      ? content.split(oldText).join(newText)
      : content.replace(oldText, newText);
    await this.writeTextFile(filePath, updated);
    return {
      path: filePath,
      replacements: options.replaceAll ? replacements : 1,
    };
  }

  async resolveDirectory(directoryPath = "."): Promise<string> {
    return this.resolveExistingPath(directoryPath);
  }

  async assertCommandArgumentsInside(directoryPath: string, args: string[]): Promise<void> {
    const commandDirectory = await this.resolveExistingPath(directoryPath);
    const rootRealpath = await this.getWorkspaceRootRealpath();
    for (const argument of args) {
      const argumentPath = extractCommandArgumentPath(argument);
      if (!argumentPath) {
        continue;
      }
      const candidatePath = path.resolve(commandDirectory, argumentPath);
      if (!isInsidePath(rootRealpath, candidatePath)) {
        throw new Error(`Command argument escapes workspace root: ${argument}`);
      }
      const resolvedPath = await resolvePathOrNearestParent(candidatePath);
      if (!isInsidePath(rootRealpath, resolvedPath)) {
        throw new Error(`Command argument escapes workspace root: ${argument}`);
      }
    }
  }

  private async resolveExistingPath(inputPath: string): Promise<string> {
    const candidatePath = await this.resolveInputPath(inputPath);
    const rootRealpath = await this.getWorkspaceRootRealpath();
    const candidateRealpath = await realpath(candidatePath);
    this.assertInsideWorkspace(rootRealpath, candidateRealpath, inputPath);
    return candidateRealpath;
  }

  private async resolveWritablePath(inputPath: string): Promise<string> {
    const candidatePath = await this.resolveInputPath(inputPath);
    const rootRealpath = await this.getWorkspaceRootRealpath();
    try {
      const existingRealpath = await realpath(candidatePath);
      this.assertInsideWorkspace(rootRealpath, existingRealpath, inputPath);
      return existingRealpath;
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        throw error;
      }
    }

    let existingParent = path.dirname(candidatePath);
    while (true) {
      try {
        const parentRealpath = await realpath(existingParent);
        this.assertInsideWorkspace(rootRealpath, parentRealpath, inputPath);
        const remainder = path.relative(existingParent, candidatePath);
        const writablePath = path.resolve(parentRealpath, remainder);
        this.assertInsideWorkspace(rootRealpath, writablePath, inputPath);
        return writablePath;
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) {
          throw error;
        }
        const nextParent = path.dirname(existingParent);
        if (nextParent === existingParent) {
          throw error;
        }
        existingParent = nextParent;
      }
    }
  }

  private async resolveInputPath(inputPath: string): Promise<string> {
    const rootRealpath = await this.getWorkspaceRootRealpath();
    if (path.isAbsolute(inputPath)) {
      return path.resolve(inputPath);
    }

    const pathSegments = inputPath.split(/[\\/]+/);
    if (pathSegments.includes("..")) {
      throw new Error(`Path escapes workspace root: ${inputPath}`);
    }
    const candidatePath = path.resolve(rootRealpath, inputPath);
    if (!isInsidePath(rootRealpath, candidatePath)) {
      throw new Error(`Path escapes workspace root: ${inputPath}`);
    }
    return candidatePath;
  }

  private assertInsideWorkspace(rootRealpath: string, candidatePath: string, inputPath: string): void {
    if (!isInsidePath(rootRealpath, candidatePath)) {
      throw new Error(`Path escapes workspace root: ${inputPath}`);
    }
  }

  private assertFileSize(bytes: number): void {
    if (bytes > this.maxFileBytes) {
      throw new Error(`File exceeds ${this.maxFileBytes} byte limit`);
    }
  }

  private async getWorkspaceRootRealpath(): Promise<string> {
    this.workspaceRootRealpath ??= await realpath(this.workspaceRoot);
    return this.workspaceRootRealpath;
  }
}

function countOccurrences(content: string, search: string): number {
  let count = 0;
  let index = 0;
  while ((index = content.indexOf(search, index)) !== -1) {
    count += 1;
    index += search.length;
  }
  return count;
}

function extractCommandArgumentPath(argument: string): string | undefined {
  if (!argument || (argument.startsWith("-") && !argument.includes("="))) {
    return undefined;
  }
  const value = argument.includes("=")
    ? argument.slice(argument.indexOf("=") + 1)
    : argument;
  return value || undefined;
}

async function resolvePathOrNearestParent(candidatePath: string): Promise<string> {
  let currentPath = candidatePath;
  while (true) {
    try {
      return await realpath(currentPath);
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        throw error;
      }
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        throw error;
      }
      currentPath = parentPath;
    }
  }
}

function isInsidePath(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function clampSearchResults(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_SEARCH_RESULTS;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("workspace.searchText maxResults must be a positive integer");
  }
  return Math.min(value, MAX_SEARCH_RESULTS);
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("workspace.searchText aborted");
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
