import type { ResponseMode } from "@story-forge/shared";

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

export function SettingsPage(props: {
  responseMode: ResponseMode;
  saving: boolean;
  error: string | undefined;
  onResponseModeChange: (responseMode: ResponseMode) => void;
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
