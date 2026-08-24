import { createHash } from "node:crypto";
import { lstat, readFile, stat } from "node:fs/promises";
import {
  SOUL_MAX_BYTES,
  type SoulDocumentView,
} from "@story-forge/shared";
import { isNodeError, writeTextAtomic } from "./atomic-json";

export type SaveSoulDocumentInput = {
  content: string;
  expectedRevision: string;
};

export class SoulRepository {
  private readonly filePath: string;

  constructor(options: { filePath: string }) {
    this.filePath = options.filePath;
  }

  async get(): Promise<SoulDocumentView> {
    try {
      const fileStat = await lstat(this.filePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
        throw new Error(`Soul path must be a regular file: ${this.filePath}`);
      }
      const content = await readFile(this.filePath, "utf8");
      return toSoulDocument({
        content,
        filePath: this.filePath,
        exists: true,
        updatedAt: fileStat.mtime.toISOString(),
      });
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return toSoulDocument({
          content: "",
          filePath: this.filePath,
          exists: false,
        });
      }
      throw error;
    }
  }

  async save(input: SaveSoulDocumentInput): Promise<SoulDocumentView> {
    const current = await this.get();
    if (current.revision !== input.expectedRevision) {
      throw new Error("Soul document changed since it was loaded. Reload it before saving.");
    }

    const content = normalizeSoulContent(input.content);
    const byteLength = Buffer.byteLength(content, "utf8");
    if (byteLength > SOUL_MAX_BYTES) {
      throw new Error(`soul.md must not exceed ${SOUL_MAX_BYTES} UTF-8 bytes`);
    }

    await writeTextAtomic(this.filePath, content, { mode: 0o600 });
    const fileStat = await stat(this.filePath);
    return toSoulDocument({
      content,
      filePath: this.filePath,
      exists: true,
      updatedAt: fileStat.mtime.toISOString(),
    });
  }
}

function normalizeSoulContent(content: string): string {
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  return normalized ? `${normalized}\n` : "";
}

function toSoulDocument(input: {
  content: string;
  filePath: string;
  exists: boolean;
  updatedAt?: string;
}): SoulDocumentView {
  return {
    content: input.content,
    revision: createHash("sha256").update(input.content).digest("hex"),
    exists: input.exists,
    byteLength: Buffer.byteLength(input.content, "utf8"),
    maxBytes: SOUL_MAX_BYTES,
    filePath: input.filePath,
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  };
}
