export function parseShellCommandForPolicy(command: string): { program: string; args: string[] } {
  if (/[|;&<>`$(){}[\]\n\r]/.test(command)) {
    return { program: "bash", args: ["-lc", command] };
  }
  const parts = command.match(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|[^\s]+/g) ?? [];
  const normalized = parts.map((part) => {
    if (
      (part.startsWith("\"") && part.endsWith("\""))
      || (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1);
    }
    return part;
  });
  return {
    program: normalized[0] ?? "",
    args: normalized.slice(1),
  };
}
