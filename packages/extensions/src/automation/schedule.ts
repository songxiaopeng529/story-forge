import type { ScheduleValidationResult } from "@story-forge/shared";
import { CronExpressionParser } from "cron-parser";

const DEFAULT_PREVIEW_COUNT = 3;

export function validateSchedule(input: {
  cron: string;
  timezone: string;
  now?: Date;
  previewCount?: number;
}): ScheduleValidationResult {
  const cron = input.cron.trim().replace(/\s+/g, " ");
  const timezone = input.timezone.trim();
  if (!isFiveFieldCron(cron)) {
    return { ok: false, error: "Cron expression must use five fields." };
  }
  if (!isValidTimezone(timezone)) {
    return { ok: false, error: `Invalid timezone: ${timezone}` };
  }

  try {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: input.now ?? new Date(),
      tz: timezone,
    });
    const count = input.previewCount ?? DEFAULT_PREVIEW_COUNT;
    const nextRuns = Array.from({ length: count }, () => interval.next().toDate().toISOString());
    return {
      ok: true,
      cron,
      timezone,
      summary: summarizeCron(cron),
      nextRuns,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function interpretSchedule(input: {
  scheduleText: string;
  timezone: string;
  now?: Date;
}): ScheduleValidationResult {
  const scheduleText = input.scheduleText.trim();
  const timezone = input.timezone.trim();
  const cron = cronFromNaturalLanguage(scheduleText);
  if (!cron) {
    return {
      ok: false,
      error: "Unable to convert schedule text. Please enter a five-field cron expression.",
    };
  }
  const validated = validateSchedule({
    cron,
    timezone,
    ...(input.now ? { now: input.now } : {}),
  });
  if (!validated.ok) {
    return validated;
  }
  return {
    ...validated,
    summary: `${validated.summary} (${scheduleText})`,
  };
}

export function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function isFiveFieldCron(cron: string): boolean {
  return cron.split(" ").filter(Boolean).length === 5;
}

function isValidTimezone(timezone: string): boolean {
  if (!timezone) {
    return false;
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function cronFromNaturalLanguage(text: string): string | undefined {
  const normalized = text.toLowerCase();
  const minuteInterval = parseMinuteInterval(normalized);
  if (minuteInterval !== undefined) {
    return minuteInterval === 1 ? "* * * * *" : `*/${minuteInterval} * * * *`;
  }

  const time = parseTime(normalized);

  if (/(每小时|hourly|every hour)/i.test(text)) {
    return "0 * * * *";
  }

  if (/(每天|每日|daily|every day)/i.test(text)) {
    return `${time.minute} ${time.hour} * * *`;
  }

  const weekday = parseWeekday(normalized);
  if (weekday !== undefined && /(每周|weekly|every week|周|星期|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(text)) {
    return `${time.minute} ${time.hour} * * ${weekday}`;
  }

  return undefined;
}

function parseMinuteInterval(text: string): number | undefined {
  if (/(每分钟|每隔一分钟|every minute)/i.test(text)) {
    return 1;
  }

  const chineseMatch = text.match(/每(?:隔)?\s*(\d{1,2})\s*分钟/);
  if (chineseMatch) {
    return clampMinuteInterval(Number(chineseMatch[1]));
  }

  const englishMatch = text.match(/every\s+(\d{1,2})\s+minutes?/i);
  if (englishMatch) {
    return clampMinuteInterval(Number(englishMatch[1]));
  }

  return undefined;
}

function clampMinuteInterval(value: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const interval = Math.trunc(value);
  return interval >= 1 && interval <= 59 ? interval : undefined;
}

function parseTime(text: string): { hour: number; minute: number } {
  const chineseMatch = text.match(/(?:上午|早上|下午|晚上)?\s*(\d{1,2})(?:[:：点](\d{1,2})?)?/);
  if (chineseMatch) {
    let hour = Number(chineseMatch[1]);
    const minute = chineseMatch[2] === undefined || chineseMatch[2] === "" ? 0 : Number(chineseMatch[2]);
    if (/(下午|晚上)/.test(text) && hour < 12) {
      hour += 12;
    }
    return clampTime(hour, minute);
  }

  const englishMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (englishMatch) {
    let hour = Number(englishMatch[1]);
    const minute = englishMatch[2] === undefined ? 0 : Number(englishMatch[2]);
    if (englishMatch[3] === "pm" && hour < 12) {
      hour += 12;
    }
    if (englishMatch[3] === "am" && hour === 12) {
      hour = 0;
    }
    return clampTime(hour, minute);
  }

  return { hour: 9, minute: 0 };
}

function clampTime(hour: number, minute: number): { hour: number; minute: number } {
  return {
    hour: Number.isFinite(hour) ? Math.min(Math.max(Math.trunc(hour), 0), 23) : 9,
    minute: Number.isFinite(minute) ? Math.min(Math.max(Math.trunc(minute), 0), 59) : 0,
  };
}

function parseWeekday(text: string): number | undefined {
  const weekdayNames = [
    ["sunday", "周日", "星期日", "星期天"],
    ["monday", "周一", "星期一"],
    ["tuesday", "周二", "星期二"],
    ["wednesday", "周三", "星期三"],
    ["thursday", "周四", "星期四"],
    ["friday", "周五", "星期五"],
    ["saturday", "周六", "星期六"],
  ];
  return weekdayNames.findIndex((aliases) => aliases.some((alias) => text.includes(alias)));
}

function summarizeCron(cron: string): string {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(" ");
  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "Every minute";
  }
  const minuteInterval = minute?.match(/^\*\/(\d+)$/);
  if (minuteInterval && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Every ${minuteInterval[1]} minutes`;
  }
  if (minute === "0" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "Every hour";
  }
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Every day at ${pad(hour)}:${pad(minute)}`;
  }
  if (dayOfMonth === "*" && month === "*" && dayOfWeek && dayOfWeek !== "*") {
    return `Every week on ${weekdayLabel(dayOfWeek)} at ${pad(hour)}:${pad(minute)}`;
  }
  return `Cron ${cron}`;
}

function pad(value: string | undefined): string {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? String(number).padStart(2, "0") : value ?? "*";
}

function weekdayLabel(value: string): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(value)]
    ?? value;
}
