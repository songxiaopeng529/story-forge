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
    const candidatePath = this.resolveRelativePath(inputPath);
    const rootRealpath = await this.getWorkspaceRootRealpath();
    const candidateRealpath = await realpath(candidatePath);
    this.assertInsideWorkspace(rootRealpath, candidateRealpath, inputPath);
    return candidateRealpath;
  }

  private async resolveWritablePath(inputPath: string): Promise<string> {
    const candidatePath = this.resolveRelativePath(inputPath);
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

  private resolveRelativePath(inputPath: string): string {
    if (path.isAbsolute(inputPath)) {
      throw new Error(`Absolute paths are not allowed: ${inputPath}`);
    }
    const pathSegments = inputPath.split(/[\\/]+/);
    if (pathSegments.includes("..")) {
      throw new Error(`Path escapes workspace root: ${inputPath}`);
    }
    const candidatePath = path.resolve(this.workspaceRoot, inputPath);
    if (!isInsidePath(this.workspaceRoot, candidatePath)) {
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

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
