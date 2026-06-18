import type { ModelRequestEvent } from "@story-forge/shared";
import { Copy, X } from "lucide-react";
import { useEffect, useState } from "react";

export function ModelRequestDrawer(props: {
  requests: ModelRequestEvent[];
  onClose: () => void;
}) {
  const [selectedRequestId, setSelectedRequestId] = useState<string>();
  const latestRequest = props.requests[props.requests.length - 1];
  const selected = props.requests.find((request) => request.requestId === selectedRequestId)
    ?? latestRequest;

  useEffect(() => {
    setSelectedRequestId(props.requests[props.requests.length - 1]?.requestId);
  }, [props.requests.length]);

  async function copySelectedRequest(): Promise<void> {
    if (!selected) {
      return;
    }
    await navigator.clipboard?.writeText(JSON.stringify(selected, null, 2));
  }

  return (
    <aside className="flex min-h-0 w-[380px] flex-none flex-col border-l border-forge-line bg-white">
      <header className="flex h-16 flex-none items-center justify-between border-b border-forge-line px-4">
        <div>
          <div className="text-sm font-semibold">Model Messages</div>
          <div className="text-xs text-slate-500">{props.requests.length} captured</div>
        </div>
        <button
          aria-label="Close model request inspector"
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
          onClick={props.onClose}
          type="button"
        >
          <X size={16} />
        </button>
      </header>

      {selected ? (
        <div className="grid min-h-0 flex-1 grid-cols-[140px_1fr]">
          <nav className="min-h-0 overflow-y-auto border-r border-forge-line p-2">
            {props.requests.map((request, index) => (
              <button
                className={`w-full rounded-md px-2 py-2 text-left text-xs ${
                  request.requestId === selected.requestId
                    ? "bg-orange-50 font-semibold text-forge-ember"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
                key={request.requestId}
                onClick={() => setSelectedRequestId(request.requestId)}
                type="button"
              >
                Model Request #{index + 1}
              </button>
            ))}
          </nav>
          <section className="min-h-0 overflow-y-auto p-4">
            <button
              className="secondary-button mb-3 inline-flex items-center gap-2"
              onClick={() => void copySelectedRequest()}
              type="button"
            >
              <Copy size={14} />
              Copy JSON
            </button>
            <div className="mb-3 text-xs text-slate-500">
              {selected.providerId} / {selected.model}
            </div>
            {selected.tools.length ? (
              <div className="mb-3 rounded-md bg-slate-50 p-2 text-xs text-slate-600">
                Tools: {selected.tools.map((tool) => tool.name).join(", ")}
              </div>
            ) : null}
            <div className="space-y-3">
              {selected.messages.map((message, index) => (
                <article
                  className="rounded-lg border border-forge-line p-3 text-xs"
                  key={`${message.role}-${index}`}
                >
                  <div className="mb-2 font-semibold text-slate-700">{message.role}</div>
                  <pre className="whitespace-pre-wrap text-slate-600">{message.content}</pre>
                  {"toolCalls" in message && message.toolCalls?.length ? (
                    <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2 text-slate-600">
                      {JSON.stringify(message.toolCalls, null, 2)}
                    </pre>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="p-4 text-sm text-slate-500">No model requests captured yet.</div>
      )}
    </aside>
  );
}
