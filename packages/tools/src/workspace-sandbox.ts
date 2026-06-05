import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export class WorkspaceSandbox {
  private readonly workspaceRoot: string;
  private workspaceRootRealpath: string | undefined;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  async readTextFile(filePath: string): Promise<string> {
    const resolvedPath = await this.resolveInsideWorkspace(filePath);
    return readFile(resolvedPath, "utf8");
  }

  async listDirectory(directoryPath = "."): Promise<string[]> {
    const resolvedPath = await this.resolveInsideWorkspace(directoryPath);
    return readdir(resolvedPath);
  }

  private async resolveInsideWorkspace(inputPath: string): Promise<string> {
    const candidatePath = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(this.workspaceRoot, inputPath);

    if (!isInsidePath(this.workspaceRoot, candidatePath)) {
      throw new Error(`Path escapes workspace root: ${inputPath}`);
    }

    const rootRealpath = await this.getWorkspaceRootRealpath();
    const candidateRealpath = await realpath(candidatePath);
    if (!isInsidePath(rootRealpath, candidateRealpath)) {
      throw new Error(`Path escapes workspace root: ${inputPath}`);
    }

    return candidateRealpath;
  }

  private async getWorkspaceRootRealpath(): Promise<string> {
    this.workspaceRootRealpath ??= await realpath(this.workspaceRoot);
    return this.workspaceRootRealpath;
  }
}

function isInsidePath(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
