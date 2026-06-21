import type {
  CommandExecutionMode,
  ResponseMode,
  WebSearchCoverage,
} from "@story-forge/shared";

const responseModes: Array<{
  value: ResponseMode;
  label: string;
  description: string;
}> = [
  {
    value: "auto",
    label: "Auto",
    description: "Use live streaming when available, otherwise smooth playback.",
  },
  {
    value: "live",
    label: "Live",
    description: "Prefer true model streaming and show unsupported-provider errors.",
  },
  {
    value: "smooth",
    label: "Smooth",
    description: "Show waiting status, then play back completed responses.",
  },
];

const commandExecutionModes: Array<{
  value: CommandExecutionMode;
  label: string;
  description: string;
}> = [
  {
    value: "sentinel",
    label: "哨兵模式",
    description: "安全优先。安全命令会直接执行，危险或未知命令会先询问你。",
  },
  {
    value: "cruise",
    label: "巡航模式",
    description: "快速推进。大多数命令会直接执行，破坏性操作会先询问你。",
  },
  {
    value: "unleashed",
    label: "无缰模式",
    description: "完全放开。命令不会再弹出确认，请只在你信任当前 Agent 时使用。",
  },
];

const webSearchCoverageModes: Array<{
  value: WebSearchCoverage;
  label: string;
  description: string;
}> = [
  {
    value: "focused",
    label: "Focused",
    description: "Use Tavily only for faster, lower-cost search.",
  },
  {
    value: "wide",
    label: "Wide",
    description: "Search Tavily and SerpApi concurrently for broader coverage.",
  },
];

export function SettingsPage(props: {
  responseMode: ResponseMode;
  developerMode: boolean;
  commandExecutionMode: CommandExecutionMode;
  webAccessEnabled: boolean;
  webSearchCoverage: WebSearchCoverage;
  saving: boolean;
  error: string | undefined;
  onResponseModeChange: (responseMode: ResponseMode) => void;
  onDeveloperModeChange: (developerMode: boolean) => void;
  onCommandExecutionModeChange: (commandExecutionMode: CommandExecutionMode) => void;
  onWebAccessEnabledChange: (enabled: boolean) => void;
  onWebSearchCoverageChange: (coverage: WebSearchCoverage) => void;
}) {
  return (
    <section className="min-h-0 min-w-0 overflow-y-auto p-8">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Global preferences for StoryForge behavior.
        </p>

        <div className="mt-7 rounded-lg border border-forge-line bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold" id="response-mode-label">
                Response mode
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Choose how model responses appear while an agent turn is running.
              </p>
            </div>
            {props.saving ? <span className="text-xs text-slate-500">Saving...</span> : null}
          </div>

          <div
            aria-labelledby="response-mode-label"
            className="mt-4 grid gap-2 sm:grid-cols-3"
            role="radiogroup"
          >
            {responseModes.map((mode) => {
              const descriptionId = `response-mode-${mode.value}-description`;
              return (
                <button
                  aria-checked={props.responseMode === mode.value}
                  aria-describedby={descriptionId}
                  aria-label={mode.label}
                  className={`rounded-md border px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-70 ${
                    props.responseMode === mode.value
                      ? "border-forge-ember bg-orange-50 text-forge-ember"
                      : "border-forge-line hover:bg-slate-50 disabled:hover:bg-white"
                  }`}
                  disabled={props.saving}
                  key={mode.value}
                  onClick={() => props.onResponseModeChange(mode.value)}
                  role="radio"
                  type="button"
                >
                  <span className="block text-sm font-medium">{mode.label}</span>
                  <span
                    className="mt-1 block text-xs text-slate-500"
                    id={descriptionId}
                  >
                    {mode.description}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 border-t border-forge-line pt-5">
            <div>
              <h3 className="text-sm font-semibold" id="command-execution-mode-label">
                Command execution
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Choose how often StoryForge asks before running workspace commands.
              </p>
            </div>

            <div
              aria-labelledby="command-execution-mode-label"
              className="mt-4 grid gap-2 sm:grid-cols-3"
              role="radiogroup"
            >
              {commandExecutionModes.map((mode) => {
                const descriptionId = `command-execution-mode-${mode.value}-description`;
                return (
                  <button
                    aria-checked={props.commandExecutionMode === mode.value}
                    aria-describedby={descriptionId}
                    aria-label={mode.label}
                    className={`rounded-md border px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-70 ${
                      props.commandExecutionMode === mode.value
                        ? "border-forge-ember bg-orange-50 text-forge-ember"
                        : "border-forge-line hover:bg-slate-50 disabled:hover:bg-white"
                    }`}
                    disabled={props.saving}
                    key={mode.value}
                    onClick={() => props.onCommandExecutionModeChange(mode.value)}
                    role="radio"
                    type="button"
                  >
                    <span className="block text-sm font-medium">{mode.label}</span>
                    <span
                      className="mt-1 block text-xs text-slate-500"
                      id={descriptionId}
                    >
                      {mode.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="mt-5 flex items-center justify-between gap-4 border-t border-forge-line pt-5">
            <span>
              <span className="block text-sm font-semibold">Developer mode</span>
              <span className="mt-1 block text-sm text-slate-500">
                Show model request messages in the chat inspector.
              </span>
            </span>
            <input
              aria-label="Developer mode"
              checked={props.developerMode}
              className="h-5 w-9 accent-forge-ember"
              disabled={props.saving}
              onChange={(event) => props.onDeveloperModeChange(event.currentTarget.checked)}
              role="switch"
              type="checkbox"
            />
          </label>

          <div className="mt-5 border-t border-forge-line pt-5">
            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-semibold">Web access</span>
                <span className="mt-1 block text-sm text-slate-500">
                  Allow StoryForge to use web search and public page extraction tools.
                </span>
              </span>
              <input
                aria-label="Web access"
                checked={props.webAccessEnabled}
                className="h-5 w-9 accent-forge-ember"
                disabled={props.saving}
                onChange={(event) =>
                  props.onWebAccessEnabledChange(event.currentTarget.checked)}
                role="switch"
                type="checkbox"
              />
            </label>

            <div className="mt-5">
              <div>
                <h3 className="text-sm font-semibold" id="web-search-coverage-label">
                  Web Search Coverage
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Choose how broadly StoryForge searches when web access is enabled.
                </p>
              </div>

              <div
                aria-labelledby="web-search-coverage-label"
                className="mt-4 grid gap-2 sm:grid-cols-2"
                role="radiogroup"
              >
                {webSearchCoverageModes.map((mode) => {
                  const descriptionId = `web-search-coverage-${mode.value}-description`;
                  const disabled = props.saving || !props.webAccessEnabled;
                  return (
                    <button
                      aria-checked={props.webSearchCoverage === mode.value}
                      aria-describedby={descriptionId}
                      aria-label={mode.label}
                      className={`rounded-md border px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${
                        props.webSearchCoverage === mode.value
                          ? "border-forge-ember bg-orange-50 text-forge-ember"
                          : "border-forge-line hover:bg-slate-50 disabled:hover:bg-white"
                      }`}
                      disabled={disabled}
                      key={mode.value}
                      onClick={() => props.onWebSearchCoverageChange(mode.value)}
                      role="radio"
                      type="button"
                    >
                      <span className="block text-sm font-medium">{mode.label}</span>
                      <span
                        className="mt-1 block text-xs text-slate-500"
                        id={descriptionId}
                      >
                        {mode.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {props.error ? (
            <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {props.error}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
