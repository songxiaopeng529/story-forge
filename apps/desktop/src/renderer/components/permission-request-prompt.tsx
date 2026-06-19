import type { PermissionRequestEvent } from "@story-forge/shared";

export function PermissionRequestPrompt(props: {
  request: PermissionRequestEvent;
  responding: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const commandLine = [props.request.command.program, ...props.request.command.args].join(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/25 px-4 pt-24">
      <section
        aria-labelledby="permission-request-title"
        className="w-full max-w-2xl rounded-lg border border-forge-line bg-white p-5 shadow-xl"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold" id="permission-request-title">
              Allow command?
            </h2>
            <p className="mt-1 text-sm text-slate-500">{props.request.reason}</p>
          </div>
          <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-forge-ember">
            {labelForRisk(props.request.risk)}
          </span>
        </div>

        <div className="mt-4 space-y-3 text-sm">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">
              Command
            </div>
            <pre className="mt-1 overflow-x-auto rounded-md bg-slate-950 px-3 py-2 text-xs text-white">
              {commandLine}
            </pre>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">
              Working directory
            </div>
            <code className="mt-1 block overflow-x-auto rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">
              {props.request.command.cwd}
            </code>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-md border border-forge-line px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={props.responding}
            onClick={props.onDeny}
            type="button"
          >
            Deny
          </button>
          <button
            className="rounded-md bg-forge-ember px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={props.responding}
            onClick={props.onApprove}
            type="button"
          >
            Allow once
          </button>
        </div>
      </section>
    </div>
  );
}

function labelForRisk(risk: PermissionRequestEvent["risk"]): string {
  if (risk === "destructive") {
    return "Destructive";
  }
  if (risk === "elevated") {
    return "Elevated";
  }
  return "Unknown";
}
