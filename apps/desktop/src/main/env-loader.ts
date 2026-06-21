import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export async function loadDotEnvFile(
  envPath: string,
  target: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  let content: string;
  try {
    content = await readFile(envPath, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return;
    }
    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(line);
    if (!parsed || target[parsed.key] !== undefined) {
      continue;
    }
    target[parsed.key] = parsed.value;
  }
}

export async function loadStoryForgeDotEnv(appPath: string): Promise<void> {
  if (isAbsolute(appPath)) {
    await loadDotEnvFile(join(appPath, ".env"));
  }
  await loadDotEnvFile(join(process.cwd(), ".env"));
}

function parseDotEnvLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex <= 0) {
    return undefined;
  }

  const key = trimmed.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return undefined;
  }

  return {
    key,
    value: unquote(trimmed.slice(equalsIndex + 1).trim()),
  };
}

function unquote(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
