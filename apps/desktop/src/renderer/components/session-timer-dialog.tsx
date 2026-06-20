import type {
  AutomationView,
  ScheduleValidationResult,
} from "@story-forge/shared";
import {
  CalendarClock,
  Check,
  Loader2,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  SessionView,
  WorkspaceView,
} from "../../shared/story-forge-api";
import { formatError } from "../renderer-utils";

export function SessionTimerDialog(props: {
  session: SessionView;
  workspace: WorkspaceView;
  timerCount: number;
  onClose: () => void;
  onCreated: (automation: AutomationView) => void;
  onError: (error: string | undefined) => void;
}) {
  const [name, setName] = useState(defaultTimerName(props.session.title));
  const [scheduleText, setScheduleText] = useState("");
  const [cron, setCron] = useState("");
  const [timezone, setTimezone] = useState(getDefaultTimezone());
  const [prompt, setPrompt] = useState("");
  const [validation, setValidation] = useState<ScheduleValidationResult>();
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setName(defaultTimerName(props.session.title));
    setScheduleText("");
    setCron("");
    setPrompt("");
    setValidation(undefined);
  }, [props.session.id, props.session.title]);

  async function generateSchedule(): Promise<void> {
    const trimmedScheduleText = scheduleText.trim();
    props.onError(undefined);
    if (!trimmedScheduleText) {
      props.onError("Please enter a schedule description first");
      return;
    }
    setGenerating(true);
    try {
      const nextValidation = await window.storyForge.automations.interpretSchedule({
        scheduleText: trimmedScheduleText,
        timezone,
      });
      setValidation(nextValidation);
      if (nextValidation.ok) {
        setCron(nextValidation.cron);
        setTimezone(nextValidation.timezone);
      } else {
        props.onError(nextValidation.error);
      }
    } catch (error) {
      props.onError(formatError(error));
    } finally {
      setGenerating(false);
    }
  }

  async function validateSchedule(): Promise<ScheduleValidationResult | undefined> {
    props.onError(undefined);
    try {
      const nextValidation = await window.storyForge.automations.validateSchedule({
        cron,
        timezone,
      });
      setValidation(nextValidation);
      if (!nextValidation.ok) {
        props.onError(nextValidation.error);
      }
      return nextValidation;
    } catch (error) {
      props.onError(formatError(error));
      return undefined;
    }
  }

  async function createTimer(): Promise<void> {
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    const trimmedScheduleText = scheduleText.trim();
    if (!trimmedName || !trimmedPrompt) {
      props.onError("Timer name and prompt are required.");
      return;
    }

    setSaving(true);
    props.onError(undefined);
    try {
      const nextValidation = validation?.ok ? validation : await validateSchedule();
      if (!nextValidation?.ok) {
        return;
      }
      const created = await window.storyForge.automations.create({
        kind: "thread_chat",
        name: trimmedName,
        status: "active",
        workspaceId: props.workspace.id,
        providerId: props.session.providerId,
        model: props.session.model,
        sessionId: props.session.id,
        schedule: {
          sourceText: trimmedScheduleText || nextValidation.summary,
          cron: nextValidation.cron,
          timezone: nextValidation.timezone,
          summary: nextValidation.summary,
        },
        prompt: trimmedPrompt,
      });
      props.onCreated(created);
      props.onClose();
    } catch (error) {
      props.onError(formatError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/20 px-4 py-14">
      <section className="w-full max-w-lg rounded-lg border border-forge-line bg-white shadow-xl">
        <header className="flex items-center gap-3 border-b border-forge-line px-4 py-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-orange-50 text-forge-ember">
            <CalendarClock size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Session timer</h2>
            <p className="truncate text-xs text-slate-500">
              {props.timerCount} active in {props.session.title}
            </p>
          </div>
          <button
            aria-label="Close timer dialog"
            className="rounded-md border border-forge-line p-2 text-slate-500 hover:bg-slate-50"
            onClick={props.onClose}
            type="button"
          >
            <X size={15} />
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          <label className="block text-xs font-medium text-slate-600">
            Timer name
            <input
              aria-label="Timer name"
              className="mt-1 w-full rounded-md border border-forge-line px-3 py-2 text-sm outline-none focus:border-forge-ember"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>

          <label className="block text-xs font-medium text-slate-600">
            Schedule
            <textarea
              aria-label="Schedule description"
              className="mt-1 h-20 w-full resize-none rounded-md border border-forge-line px-3 py-2 text-sm outline-none focus:border-forge-ember"
              onChange={(event) => setScheduleText(event.target.value)}
              placeholder="Every weekday at 9 AM"
              value={scheduleText}
            />
          </label>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-medium text-forge-ember disabled:opacity-50"
            disabled={generating}
            onClick={() => void generateSchedule()}
            type="button"
          >
            {generating ? <Loader2 className="animate-spin" size={14} /> : <Wand2 size={14} />}
            Generate schedule
          </button>

          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <label className="block text-xs font-medium text-slate-600">
              Cron
              <input
                aria-label="Cron expression"
                className="mt-1 w-full rounded-md border border-forge-line px-3 py-2 font-mono text-sm outline-none focus:border-forge-ember"
                onChange={(event) => {
                  setCron(event.target.value);
                  setValidation(undefined);
                }}
                placeholder="0 9 * * *"
                value={cron}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Timezone
              <input
                aria-label="Timezone"
                className="mt-1 w-full rounded-md border border-forge-line px-3 py-2 text-sm outline-none focus:border-forge-ember"
                onChange={(event) => {
                  setTimezone(event.target.value);
                  setValidation(undefined);
                }}
                value={timezone}
              />
            </label>
          </div>

          {validation?.ok ? (
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700">
              {validation.summary}
            </div>
          ) : null}

          <label className="block text-xs font-medium text-slate-600">
            Prompt
            <textarea
              aria-label="Timer prompt"
              className="mt-1 h-24 w-full resize-none rounded-md border border-forge-line px-3 py-2 text-sm outline-none focus:border-forge-ember"
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Continue from the current session and check..."
              value={prompt}
            />
          </label>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-forge-line px-4 py-3">
          <button
            className="rounded-md border border-forge-line px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            onClick={props.onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-forge-ember px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={saving}
            onClick={() => void createTimer()}
            type="button"
          >
            {saving ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
            Create timer
          </button>
        </footer>
      </section>
    </div>
  );
}

function defaultTimerName(title: string): string {
  return title.trim() ? `${title.trim()} timer` : "Session timer";
}

function getDefaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
