import type { PiModelService } from "@story-forge/agent";
import type { ProviderId } from "@story-forge/shared";

export type ScheduleCronGeneratorInput = {
  scheduleText: string;
  timezone: string;
  providerId: ProviderId;
  model: string;
  now: Date;
  signal?: AbortSignal;
};

export type ScheduleCronGenerator = (input: ScheduleCronGeneratorInput) => Promise<string>;

const SCHEDULE_CRON_SYSTEM_PROMPT = [
  "Convert a recurring schedule description into one standard five-field cron expression.",
  "Return JSON only, exactly like {\"cron\":\"0 9 * * *\"}.",
  "Use fields in this order: minute hour day-of-month month day-of-week.",
  "Do not include seconds, year, timezone names, Markdown, or explanations.",
  "Use only numbers, *, ranges, lists, and step values.",
].join("\n");

export function createScheduleCronGenerator(
  piModels: Pick<PiModelService, "completeText">,
): ScheduleCronGenerator {
  return async (input) => {
    const output = await piModels.completeText({
      providerId: input.providerId,
      model: input.model,
      systemPrompt: SCHEDULE_CRON_SYSTEM_PROMPT,
      prompt: buildScheduleCronPrompt(input),
      maxTokens: 64,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const cron = extractCronExpression(output);
    if (!cron) {
      throw new Error("Model did not return a cron expression.");
    }
    return cron;
  };
}

function buildScheduleCronPrompt(input: ScheduleCronGeneratorInput): string {
  return [
    `Schedule description: ${input.scheduleText}`,
    `Timezone: ${input.timezone}`,
    `Current time: ${input.now.toISOString()}`,
  ].join("\n");
}

export function extractCronExpression(output: string): string | undefined {
  const text = stripCodeFence(output.trim());
  const jsonCron = extractJsonCron(text);
  if (jsonCron.matched) {
    return jsonCron.value;
  }
  return extractBareCron(text);
}

type JsonCronExtraction =
  | { matched: false }
  | { matched: true; value: string | undefined };

function extractJsonCron(text: string): JsonCronExtraction {
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed) && "cron" in parsed) {
        return {
          matched: true,
          value: typeof parsed.cron === "string" ? normalizeCron(parsed.cron) : undefined,
        };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return { matched: false };
}

function jsonCandidates(text: string): string[] {
  const candidates = [text];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    candidates.push(text.slice(start, end + 1));
  }
  return candidates;
}

function extractBareCron(text: string): string | undefined {
  const candidate = text.replace(/^cron\s*:\s*/iu, "").trim();
  if (!/^[0-9*/,-]+(?:\s+[0-9*/,-]+){4}$/u.test(candidate)) {
    return undefined;
  }
  return normalizeCron(candidate);
}

function normalizeCron(value: string): string | undefined {
  const cron = value.trim().replace(/\s+/g, " ");
  return cron.split(" ").filter(Boolean).length === 5 ? cron : undefined;
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/u, "")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
