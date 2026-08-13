import type {
  AppLanguage,
  CommandExecutionMode,
  WebSearchCoverage,
} from "@story-forge/shared";
import { useI18n } from "../i18n";

export function SettingsPage(props: {
  language: AppLanguage;
  developerMode: boolean;
  commandExecutionMode: CommandExecutionMode;
  commandModeLocked: boolean;
  webAccessEnabled: boolean;
  webSearchCoverage: WebSearchCoverage;
  saving: boolean;
  error: string | undefined;
  onLanguageChange: (language: AppLanguage) => void;
  onDeveloperModeChange: (developerMode: boolean) => void;
  onCommandExecutionModeChange: (commandExecutionMode: CommandExecutionMode) => void;
  onWebAccessEnabledChange: (enabled: boolean) => void;
  onWebSearchCoverageChange: (coverage: WebSearchCoverage) => void;
}) {
  const t = useI18n();
  const commandExecutionModes = (["sentinel", "cruise", "unleashed"] as const)
    .map((value) => ({ value, ...t.commandMode[value] }));
  const webSearchCoverageModes = (["focused", "wide"] as const)
    .map((value) => ({ value, ...t.webSearchCoverage[value] }));

  return (
    <section className="min-h-0 min-w-0 overflow-y-auto p-8">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-xl font-semibold">{t.settings.title}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {t.settings.subtitle}
        </p>

        <div className="mt-7 rounded-lg border border-forge-line bg-white p-5 shadow-sm">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
              <h3 className="text-sm font-semibold" id="language-label">
                {t.settings.languageTitle}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {t.settings.languageDescription}
              </p>
              </div>
              {props.saving ? <span className="text-xs text-slate-500">{t.settings.saving}</span> : null}
            </div>

            <div
              aria-labelledby="language-label"
              className="mt-4 grid gap-2 sm:grid-cols-2"
              role="radiogroup"
            >
              {t.settings.languageOptions.map((mode) => {
                const descriptionId = `language-${mode.value}-description`;
                return (
                  <button
                    aria-checked={props.language === mode.value}
                    aria-describedby={descriptionId}
                    aria-label={mode.label}
                    className={`rounded-md border px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-70 ${
                      props.language === mode.value
                        ? "border-2 border-forge-ember text-forge-ember"
                        : "border-forge-line hover:bg-slate-50 disabled:hover:bg-white"
                    }`}
                    disabled={props.saving}
                    key={mode.value}
                    onClick={() => props.onLanguageChange(mode.value)}
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

          <div className="mt-5 border-t border-forge-line pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
              <h3 className="text-sm font-semibold" id="command-execution-mode-label">
                {t.settings.commandExecutionTitle}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {t.settings.commandExecutionDescription}
              </p>
              </div>
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
                    aria-label={mode.chip}
                    className={`rounded-md border px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-70 ${
                      props.commandExecutionMode === mode.value
                        ? "border-2 border-forge-ember text-forge-ember"
                        : "border-forge-line hover:bg-slate-50 disabled:hover:bg-white"
                    }`}
                    disabled={props.saving || props.commandModeLocked}
                    key={mode.value}
                    onClick={() => props.onCommandExecutionModeChange(mode.value)}
                    role="radio"
                    type="button"
                  >
                    <span className="block text-sm font-medium">{mode.chip}</span>
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
            <p className="mt-3 text-xs leading-5 text-slate-500">
              {t.settings.commandExecutionNotice}
            </p>
            {props.commandModeLocked ? (
              <p className="mt-1 text-xs leading-5 text-forge-ember" role="status">
                {t.agent.commandModeUnavailableWhileRunning}. {t.agent.commandModeAppliesToNewTurns}
              </p>
            ) : null}
          </div>

          <label className="mt-5 flex items-center justify-between gap-4 border-t border-forge-line pt-5">
            <span>
              <span className="block text-sm font-semibold">{t.settings.developerModeTitle}</span>
              <span className="mt-1 block text-sm text-slate-500">
                {t.settings.developerModeDescription}
              </span>
            </span>
            <input
              aria-label={t.settings.developerModeTitle}
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
                <span className="block text-sm font-semibold">{t.settings.webAccessTitle}</span>
                <span className="mt-1 block text-sm text-slate-500">
                  {t.settings.webAccessDescription}
                </span>
              </span>
              <input
                aria-label={t.settings.webAccessTitle}
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
                  {t.settings.webSearchCoverageTitle}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {t.settings.webSearchCoverageDescription}
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
                          ? "border-2 border-forge-ember text-forge-ember"
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
