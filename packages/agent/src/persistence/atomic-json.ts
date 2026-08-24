import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ZodType } from "zod";

export function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Read a JSON file, parse it, and validate against a Zod schema.
 * Returns `fallback` when the file does not exist; throws on parse/validation errors.
 */
export async function readJson<T>(
  filePath: string,
  schema: ZodType<T>,
  fallback: T,
): Promise<T> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return fallback;
    }
    throw error;
  }
}

/**
 * Read a JSON file, parse it, and validate against a Zod schema.
 * On corruption (non-ENOENT errors), quarantines the bad file by renaming it to
 * `<path>.corrupt-<timestamp>` and throws a descriptive error.
 */
export async function readJsonOrQuarantine<T>(
  filePath: string,
  schema: ZodType<T>,
  errorMessage: string,
): Promise<T> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw error;
    }
    const corruptPath = `${filePath}.corrupt-${Date.now()}`;
    await rename(filePath, corruptPath).catch(() => undefined);
    throw new Error(errorMessage, { cause: error });
  }
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  options: { mode?: number } = {},
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    ...(options.mode === undefined ? {} : { mode: options.mode }),
  });
  await rename(temporaryPath, filePath);
}

export async function writeTextAtomic(
  filePath: string,
  content: string,
  options: { mode?: number } = {},
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, content, {
    encoding: "utf8",
    ...(options.mode === undefined ? {} : { mode: options.mode }),
  });
  await rename(temporaryPath, filePath);
}
