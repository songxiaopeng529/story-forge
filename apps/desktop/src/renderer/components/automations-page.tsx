import type { ProviderId } from "@story-forge/model-gateway";
import type {
  AutomationView,
  ScheduleValidationResult,
} from "@story-forge/shared";
import {
  CalendarClock,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  ProviderView,
  SessionView,
  WorkspaceView,
} from "../../shared/story-forge-api";
import { formatError } from "../renderer-utils";

export function AutomationsPage(props: {
  providers: ProviderView[];
  sessions: SessionView[];
  workspaces: WorkspaceView[];
  error: string | undefined;
  onError: (error: string | undefined) => void;
}) {
  const defaultProvider = props.providers.find((provider) => provider.isDefault)
    ?? props.providers[0];
  const defaultWorkspace = props.workspaces[0];
  const [automations, setAutomations] = useState<AutomationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspace?.id ?? "");
  const [providerId, setProviderId] = useState<ProviderId>(
    defaultProvider?.providerId ?? "deepseek",
  );
  const [model, setModel] = useState(defaultProvider?.model ?? "");
  const [scheduleText, setScheduleText] = useState("");
  const [cron, setCron] = useState("");
  const [timezone, setTimezone] = useState(getDefaultTimezone());
  const [prompt, setPrompt] = useState("");
  const [validation, setValidation] = useState<ScheduleValidationResult>();

  const selectedProvider = useMemo(
    () => props.providers.find((provider) => provider.providerId === providerId),
    [providerId, props.providers],
  );

  useEffect(() => {
    if (!workspaceId && defaultWorkspace) {
      setWorkspaceId(defaultWorkspace.id);
    }
  }, [defaultWorkspace, workspaceId]);

  useEffect(() => {
    if (defaultProvider && !model) {
      setProviderId(defaultProvider.providerId);
      setModel(defaultProvider.model);
    }
  }, [defaultProvider, model]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const nextAutomations = await window.storyForge.automations.list();
        if (!disposed) {
          setAutomations(nextAutomations);
        }
      } catch (loadError) {
        props.onError(formatError(loadError));
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [props.onError]);

  async function generateSchedule(): Promise<void> {
    props.onError(undefined);
    const trimmedScheduleText = scheduleText.trim();
    if (!trimmedScheduleText) {
      props.onError("Please enter a schedule description first");
      return;
    }
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
    } catch (generateError) {
      props.onError(formatError(generateError));
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
    } catch (validationError) {
      props.onError(formatError(validationError));
      return undefined;
    }
  }

  async function saveAutomation(): Promise<void> {
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    const trimmedScheduleText = scheduleText.trim();
    if (!trimmedName || !trimmedPrompt || !workspaceId || !model.trim()) {
      props.onError("Automation name, workspace, model, and prompt are required.");
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
        name: trimmedName,
        status: "active",
        workspaceId,
        providerId,
        model: model.trim(),
        schedule: {
          sourceText: trimmedScheduleText || nextValidation.summary,
          cron: nextValidation.cron,
          timezone: nextValidation.timezone,
          summary: nextValidation.summary,
        },
        prompt: trimmedPrompt,
      });
      setAutomations((current) => [created, ...current]);
      setName("");
      setPrompt("");
    } catch (saveError) {
      props.onError(formatError(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(automation: AutomationView, status: AutomationView["status"]) {
    props.onError(undefined);
    try {
      const updated = await window.storyForge.automations.update({
        automationId: automation.id,
        status,
      });
      setAutomations((current) => current.map((candidate) =>
        candidate.id === automation.id ? updated : candidate
      ));
    } catch (updateError) {
      props.onError(formatError(updateError));
    }
  }

  async function runNow(automation: AutomationView) {
    props.onError(undefined);
    try {
      const run = await window.storyForge.automations.runNow(automation.id);
      setAutomations((current) => current.map((candidate) =>
        candidate.id === automation.id
          ? {
              ...candidate,
              lastRunAt: run.startedAt ?? run.scheduledFor,
              lastRunStatus: run.status,
            }
          : candidate
      ));
    } catch (runError) {
      props.onError(formatError(runError));
    }
  }

  async function deleteAutomation(automation: AutomationView) {
    props.onError(undefined);
    try {
      await window.storyForge.automations.delete(automation.id);
      setAutomations((current) =>
        current.filter((candidate) => candidate.id !== automation.id)
      );
    } catch (deleteError) {
      props.onError(formatError(deleteError));
    }
  }

  return (
    <section className="min-h-0 overflow-auto p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Automations</h2>
            <p className="mt-1 text-sm text-slate-500">
              Schedule local StoryForge chats while the desktop app is open.
            </p>
          </div>
          <CalendarClock className="text-forge-ember" size={24} />
        </div>

        {props.error ? (
          <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {props.error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-5 lg:grid-cols-[360px_1fr]">
          <form
            className="rounded-lg border border-forge-line bg-white p-4 shadow-sm"
            onSubmit={(event) => {
              event.preventDefault();
              void saveAutomation();
            }}
          >
            <div className="text-sm font-semibold">New automation</div>
            <div className="mt-4 space-y-3">
              <Field label="Automation name">
                <input
                  aria-label="Automation name"
                  className={inputClassName}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Daily risk audit"
                  value={name}
                />
              </Field>
              <Field label="Workspace">
                <select
                  aria-label="Workspace"
                  className={inputClassName}
                  onChange={(event) => setWorkspaceId(event.target.value)}
                  value={workspaceId}
                >
                  {props.workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.displayName}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Provider">
                  <select
                    aria-label="Provider"
                    className={inputClassName}
                    onChange={(event) => {
                      const nextProviderId = event.target.value as ProviderId;
                      const nextProvider = props.providers.find((provider) =>
                        provider.providerId === nextProviderId
                      );
                      setProviderId(nextProviderId);
                      setModel(nextProvider?.model ?? "");
                    }}
                    value={providerId}
                  >
                    {props.providers.map((provider) => (
                      <option key={provider.providerId} value={provider.providerId}>
                        {provider.displayName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Model">
                  <input
                    aria-label="Model"
                    className={inputClassName}
                    list="automation-models"
                    onChange={(event) => setModel(event.target.value)}
                    value={model}
                  />
                  <datalist id="automation-models">
                    {(selectedProvider?.recommendedModels ?? []).map((recommendedModel) => (
                      <option key={recommendedModel} value={recommendedModel} />
                    ))}
                  </datalist>
                </Field>
              </div>
              <Field label="Schedule description">
                <input
                  aria-label="Schedule description"
                  className={inputClassName}
                  onChange={(event) => {
                    setScheduleText(event.target.value);
                    setValidation(undefined);
                  }}
                  placeholder="每天早上 9 点"
                  value={scheduleText}
                />
              </Field>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <button
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-forge-line px-3 text-sm font-medium hover:bg-slate-50"
                  onClick={() => void generateSchedule()}
                  type="button"
                >
                  <Wand2 size={15} />
                  Generate schedule
                </button>
                <button
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-forge-line px-3 text-sm font-medium hover:bg-slate-50"
                  onClick={() => void validateSchedule()}
                  type="button"
                >
                  <RefreshCw size={15} />
                  Validate
                </button>
              </div>
              <div className="grid grid-cols-[1fr_150px] gap-3">
                <Field label="Cron">
                  <input
                    aria-label="Cron"
                    className={inputClassName}
                    onChange={(event) => {
                      setCron(event.target.value);
                      setValidation(undefined);
                    }}
                    placeholder="0 9 * * *"
                    value={cron}
                  />
                </Field>
                <Field label="Timezone">
                  <input
                    aria-label="Timezone"
                    className={inputClassName}
                    onChange={(event) => {
                      setTimezone(event.target.value);
                      setValidation(undefined);
                    }}
                    value={timezone}
                  />
                </Field>
              </div>
              {validation?.ok ? (
                <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
                  <div className="font-semibold">{validation.summary}</div>
                  <div>{validation.nextRuns.map(formatDateTime).join(" / ")}</div>
                </div>
              ) : null}
              <Field label="Automation prompt">
                <textarea
                  aria-label="Automation prompt"
                  className={`${inputClassName} h-24 resize-none`}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ask StoryForge to inspect the repo and summarize risks."
                  value={prompt}
                />
              </Field>
            </div>
            <button
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-forge-ember px-3 text-sm font-medium text-white disabled:opacity-40"
              disabled={saving || !props.providers.length || !props.workspaces.length}
              type="submit"
            >
              <Play size={15} />
              Save automation
            </button>
          </form>

          <div className="min-w-0 rounded-lg border border-forge-line bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-forge-line px-4 py-3">
              <div className="text-sm font-semibold">Scheduled chats</div>
              <div className="text-xs text-slate-500">{automations.length} total</div>
            </div>
            <div className="divide-y divide-forge-line">
              {loading ? (
                <div className="p-4 text-sm text-slate-500">Loading automations...</div>
              ) : automations.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">
                  No automations yet.
                </div>
              ) : (
                automations.map((automation) => (
                  <AutomationRow
                    automation={automation}
                    key={automation.id}
                    sessionTitle={getSessionTitle(automation, props.sessions)}
                    onDelete={() => void deleteAutomation(automation)}
                    onRunNow={() => void runNow(automation)}
                    onStatusChange={(status) => void updateStatus(automation, status)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AutomationRow(props: {
  automation: AutomationView;
  sessionTitle: string | undefined;
  onRunNow: () => void;
  onStatusChange: (status: AutomationView["status"]) => void;
  onDelete: () => void;
}) {
  const isActive = props.automation.status === "active";
  const threadTimer = props.automation.kind === "thread_chat";
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{props.automation.name}</h3>
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-forge-ember">
              {threadTimer ? "Session timer" : "New session"}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                isActive
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {props.automation.status}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {props.automation.schedule.summary} · {props.automation.schedule.timezone}
          </div>
          {threadTimer ? (
            <div className="mt-1 text-xs text-slate-500">
              Session: {props.sessionTitle ?? props.automation.sessionId ?? "missing"}
            </div>
          ) : null}
          <div className="mt-2 text-sm text-slate-700 line-clamp-2">
            {props.automation.prompt}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
            <span>Next: {formatMaybeDate(props.automation.nextRunAt)}</span>
            <span>Last: {props.automation.lastRunStatus ?? "never"}</span>
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <button
            aria-label={`Run ${props.automation.name} now`}
            className="rounded-md border border-forge-line p-2 text-slate-600 hover:bg-slate-50"
            onClick={props.onRunNow}
            title="Run now"
            type="button"
          >
            <Play size={15} />
          </button>
          <button
            aria-label={`${isActive ? "Pause" : "Resume"} ${props.automation.name}`}
            className="rounded-md border border-forge-line p-2 text-slate-600 hover:bg-slate-50"
            onClick={() => props.onStatusChange(isActive ? "paused" : "active")}
            title={isActive ? "Pause" : "Resume"}
            type="button"
          >
            {isActive ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            aria-label={`Delete ${props.automation.name}`}
            className="rounded-md border border-forge-line p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
            onClick={props.onDelete}
            title="Delete"
            type="button"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{props.label}</span>
      <div className="mt-1">{props.children}</div>
    </label>
  );
}

const inputClassName =
  "w-full rounded-md border border-forge-line bg-white px-3 py-2 text-sm outline-none focus:border-forge-ember focus:ring-2 focus:ring-orange-100";

function getDefaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function formatMaybeDate(value: string | undefined): string {
  return value ? formatDateTime(value) : "not scheduled";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getSessionTitle(
  automation: AutomationView,
  sessions: SessionView[],
): string | undefined {
  if (automation.kind !== "thread_chat" || !automation.sessionId) {
    return undefined;
  }
  return sessions.find((session) => session.id === automation.sessionId)?.title;
}
