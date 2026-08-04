import type { RuntimeEnvironmentView } from "@story-forge/shared";
import type { ToolDefinition } from "../tool-definition";

export type RuntimeClock = () => Date;
export type RuntimeTimezoneResolver = () => string;

export type CurrentTimeOutput = RuntimeEnvironmentView & {
  currentTime: string;
  iso8601: string;
  utcTime: string;
  utcOffset: string;
  unixTime: number;
};

export function createRuntimeEnvironment(
  now: Date,
  timezone: string,
): RuntimeEnvironmentView {
  assertValidTimezone(timezone);
  const parts = dateTimeParts(now, timezone);
  return {
    currentDate: `${parts.year}-${parts.month}-${parts.day}`,
    timezone,
  };
}

export function formatRuntimeEnvironmentContext(environment: RuntimeEnvironmentView): string {
  return [
    "<environment_context>",
    `  <current_date>${environment.currentDate}</current_date>`,
    `  <timezone>${environment.timezone}</timezone>`,
    "</environment_context>",
  ].join("\n");
}

export function createCurrentTimeTool(options: {
  now?: RuntimeClock;
  getTimezone?: RuntimeTimezoneResolver;
} = {}): ToolDefinition {
  const now = options.now ?? (() => new Date());
  const getTimezone = options.getTimezone ?? resolveSystemTimezone;

  return {
    name: "current_time",
    description: "Return the exact current time. Use only when date-level environment context is insufficient.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "Optional IANA timezone such as Asia/Shanghai. Defaults to the user's system timezone.",
        },
      },
    },
    execute: (input) => {
      const requestedTimezone = typeof input.timezone === "string"
        ? input.timezone.trim()
        : "";
      const timezone = requestedTimezone || getTimezone();
      return createCurrentTimeOutput(now(), timezone);
    },
  };
}

export function resolveSystemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function createCurrentTimeOutput(now: Date, timezone: string): CurrentTimeOutput {
  const environment = createRuntimeEnvironment(now, timezone);
  const parts = dateTimeParts(now, timezone);
  const utcOffset = timezoneOffset(now, timezone);
  const currentTime = `${parts.hour}:${parts.minute}:${parts.second}`;
  return {
    ...environment,
    currentTime,
    iso8601: `${environment.currentDate}T${currentTime}${utcOffset}`,
    utcTime: now.toISOString(),
    utcOffset,
    unixTime: Math.floor(now.getTime() / 1000),
  };
}

function dateTimeParts(now: Date, timezone: string): Record<
  "year" | "month" | "day" | "hour" | "minute" | "second",
  string
> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: values.year ?? "0000",
    month: values.month ?? "00",
    day: values.day ?? "00",
    hour: values.hour ?? "00",
    minute: values.minute ?? "00",
    second: values.second ?? "00",
  };
}

function timezoneOffset(now: Date, timezone: string): string {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(now).find((candidate) => candidate.type === "timeZoneName")?.value;
  if (!part || part === "GMT") {
    return "+00:00";
  }
  const match = /^GMT([+-]\d{2}:\d{2})$/.exec(part);
  if (!match?.[1]) {
    throw new Error(`Unable to resolve UTC offset for timezone: ${timezone}`);
  }
  return match[1];
}

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}
