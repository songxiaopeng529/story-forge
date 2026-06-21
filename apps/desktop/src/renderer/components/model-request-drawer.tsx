import type { InspectableModelMessage, ModelRequestEvent } from "@story-forge/shared";
import { ChevronLeft, ChevronRight, Copy, Layers, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type Selection = "overview" | number;
type DetailMode = "content" | "raw";

export function ModelRequestDrawer(props: {
  requests: ModelRequestEvent[];
  onClose: () => void;
}) {
  const [requestIndex, setRequestIndex] = useState(0);
  const [selection, setSelection] = useState<Selection>("overview");
  const [detailMode, setDetailMode] = useState<DetailMode>("raw");

  useEffect(() => {
    setRequestIndex(Math.max(props.requests.length - 1, 0));
    setSelection("overview");
    setDetailMode("raw");
  }, [props.requests.length]);

  const selected = props.requests[requestIndex];
  const selectedMessage = selected && selection !== "overview"
    ? selected.messages[selection]
    : undefined;
  const viewLabel = selection === "overview" ? "request" : `request.messages[${selection}]`;
  const rawJson = selected
    ? selection === "overview"
      ? rawPayloadJson(selected)
      : JSON.stringify(selectedMessage, null, 2)
    : "";
  const contentPreview = selectedMessage
    ? previewContent(selectedMessage.content)
    : "";
  const showingContent = Boolean(selectedMessage && detailMode === "content");

  async function copyRawJson(): Promise<void> {
    if (!selected) {
      return;
    }
    await navigator.clipboard?.writeText(rawJson);
  }

  function select(nextSelection: Selection): void {
    setSelection(nextSelection);
    setDetailMode(nextSelection === "overview" ? "raw" : "content");
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-[520px] flex-col border-l border-forge-line bg-white shadow-[-18px_0_28px_0_rgba(0,0,0,0.14)]">
      <header className="relative flex-none border-b border-forge-line px-6 py-[18px]">
        <div className="pr-32">
          <div className="text-base font-semibold text-forge-ink">Inspector</div>
          <div className="text-[11px] text-forge-muted">Raw request payload sent to the model</div>
        </div>
        <div className="absolute right-5 top-[22px] flex items-center gap-2">
          <button
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-forge-line bg-white px-3 text-[11px] font-medium text-forge-ink hover:bg-forge-canvas disabled:opacity-40"
            disabled={!selected}
            onClick={() => void copyRawJson()}
            type="button"
          >
            <Copy size={15} />
            Copy JSON
          </button>
          <button
            aria-label="Close model request inspector"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas hover:text-forge-ink"
            onClick={props.onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        {props.requests.length > 1 ? (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-forge-muted">
            <button
              aria-label="Previous request"
              className="flex h-6 w-6 items-center justify-center rounded-md border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas disabled:opacity-40"
              disabled={requestIndex === 0}
              onClick={() => {
                setRequestIndex((index) => Math.max(index - 1, 0));
                setSelection("overview");
                setDetailMode("raw");
              }}
              type="button"
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              Request {requestIndex + 1} / {props.requests.length}
            </span>
            <button
              aria-label="Next request"
              className="flex h-6 w-6 items-center justify-center rounded-md border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas disabled:opacity-40"
              disabled={requestIndex >= props.requests.length - 1}
              onClick={() => {
                setRequestIndex((index) => Math.min(index + 1, props.requests.length - 1));
                setSelection("overview");
                setDetailMode("raw");
              }}
              type="button"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        ) : null}
      </header>

      {selected ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-5">
          <div className="grid flex-none grid-cols-4 gap-2 rounded-[10px] border border-forge-line bg-forge-canvas px-4 py-2.5">
            <SummaryCell label="Messages" value={`${selected.messages.length}`} />
            <SummaryCell label="Tools" value={`${selected.tools.length}`} />
            <SummaryCell label="Model" value={selected.model} />
            <SummaryCell
              label="Stream"
              value={selected.responseMode === "smooth" ? "false" : "true"}
            />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[188px_1fr] overflow-hidden rounded-[10px] border border-forge-line">
            <div className="min-h-0 overflow-y-auto border-r border-forge-line p-3">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-forge-ink">messages[]</span>
                <span className="text-[10px] text-forge-muted">
                  {selected.messages.length} items
                </span>
              </div>
              <div className="space-y-2">
                <button
                  className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left ${
                    selection === "overview"
                      ? "border-[1.2px] border-forge-ink bg-forge-canvas"
                      : "border-forge-line bg-white hover:bg-forge-canvas"
                  }`}
                  onClick={() => select("overview")}
                  type="button"
                >
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-forge-ink/[0.06] text-forge-ink">
                    <Layers size={13} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-medium text-forge-ink">
                      Overview
                    </span>
                    <span className="block truncate text-[9px] text-forge-muted">
                      Full outbound payload
                    </span>
                  </span>
                </button>
                <div className="h-px bg-forge-divider" />
                {selected.messages.map((message, index) => {
                  const summary = summarizeMessage(message);
                  const active = selection === index;
                  return (
                    <button
                      className={`w-full rounded-lg border px-2.5 py-2 text-left ${
                        active
                          ? "border-[1.2px] border-forge-ink bg-forge-canvas"
                          : "border-forge-line bg-white hover:bg-forge-canvas"
                      }`}
                      key={`${message.role}-${index}`}
                      onClick={() => select(index)}
                      type="button"
                    >
                      <div className="flex items-center justify-between">
                        <RolePill role={message.role} />
                        <span className="text-[10px] font-medium text-forge-muted">#{index}</span>
                      </div>
                      <div className="mt-1.5 truncate text-[11px] font-medium text-forge-ink">
                        {summary.title}
                      </div>
                      <div className="truncate text-[9px] text-forge-muted">{summary.detail}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-col bg-[#18191b]">
              <div className="flex flex-none items-center justify-between bg-[#222326] px-3.5 py-3">
                <span className="text-[11px] font-semibold text-[#e6e9ef]">
                  {viewLabel}
                </span>
                {selectedMessage ? (
                  <div className="flex rounded-md border border-white/10 bg-black/20 p-0.5">
                    <button
                      aria-pressed={detailMode === "content"}
                      className={`rounded px-2 py-1 text-[10px] font-medium ${
                        detailMode === "content"
                          ? "bg-white/12 text-[#f4f6fb]"
                          : "text-[#95989f] hover:text-[#e6e9ef]"
                      }`}
                      onClick={() => setDetailMode("content")}
                      type="button"
                    >
                      Content Preview
                    </button>
                    <button
                      aria-pressed={detailMode === "raw"}
                      className={`rounded px-2 py-1 text-[10px] font-medium ${
                        detailMode === "raw"
                          ? "bg-white/12 text-[#f4f6fb]"
                          : "text-[#95989f] hover:text-[#e6e9ef]"
                      }`}
                      onClick={() => setDetailMode("raw")}
                      type="button"
                    >
                      Raw JSON
                    </button>
                  </div>
                ) : (
                  <span className="text-[10px] font-medium text-[#95989f]">raw JSON</span>
                )}
              </div>
              {showingContent ? (
                <pre
                  className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3.5 py-3 font-mono text-[10px] leading-[15px] text-[#e6e9ef]"
                  data-testid="model-message-content-preview"
                >
                  {renderContentPreview(contentPreview)}
                </pre>
              ) : (
                <pre
                  className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3.5 py-3 font-mono text-[10px] leading-[15px] text-[#e6e9ef]"
                  data-testid="model-message-raw-json"
                >
                  {rawJson}
                </pre>
              )}
            </div>
          </div>

          <div className="flex-none rounded-[10px] border border-forge-line bg-forge-canvas px-3.5 py-2.5">
            <p className="text-[10px] leading-[15px] text-forge-muted">
              Display rule: show the exact outbound payload first. Parsed summaries can help
              navigation, but must never replace the raw JSON.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-6 text-sm text-forge-muted">No model requests captured yet.</div>
      )}
    </aside>
  );
}

function SummaryCell(props: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-forge-muted">{props.label}</div>
      <div className="truncate text-xs font-semibold text-forge-ink" title={props.value}>
        {props.value}
      </div>
    </div>
  );
}

function RolePill(props: { role: InspectableModelMessage["role"] }) {
  const tone: Record<InspectableModelMessage["role"], string> = {
    system: "bg-[rgba(110,110,115,0.08)] text-forge-muted",
    user: "bg-[rgba(29,29,31,0.08)] text-forge-ink",
    assistant: "bg-[rgba(0,122,255,0.08)] text-forge-info",
    tool: "bg-[rgba(52,199,89,0.08)] text-forge-success-line",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone[props.role]}`}
    >
      {props.role}
    </span>
  );
}

function summarizeMessage(message: InspectableModelMessage): { title: string; detail: string } {
  if (message.role === "system") {
    return { title: "Runtime instructions", detail: firstLine(message.content) };
  }
  if (message.role === "user") {
    return { title: "User request", detail: firstLine(message.content) };
  }
  if (message.role === "tool") {
    return { title: `${message.name} result`, detail: firstLine(message.content) };
  }
  if (message.toolCalls?.length) {
    return {
      title: "Tool planning",
      detail: `calls ${message.toolCalls.map((call) => call.name).join(", ")}`,
    };
  }
  return { title: "Assistant message", detail: firstLine(message.content) };
}

function firstLine(content: string): string {
  const line = content.split("\n").map((value) => value.trim()).find(Boolean);
  return line ?? "—";
}

function previewContent(content: string): string {
  if (!looksLikeXml(content)) {
    return content;
  }
  return formatXml(content);
}

function looksLikeXml(content: string): boolean {
  return /^<[\w:-]+(?:\s|>|\/>)/.test(content.trim());
}

function formatXml(content: string): string {
  const normalized = content.trim();
  if (normalized.includes("\n")) {
    return normalized;
  }

  const tokens = normalized
    .replace(/>\s*</g, "><")
    .split(/(?=<)|(?<=>)/g)
    .map((token) => token.trim())
    .filter(Boolean);
  let depth = 0;
  const lines: string[] = [];

  for (const token of tokens) {
    if (token.startsWith("</")) {
      depth = Math.max(depth - 1, 0);
    }
    lines.push(`${"  ".repeat(depth)}${token}`);
    if (token.startsWith("<") && !token.startsWith("</") && !token.endsWith("/>")
      && !token.startsWith("<?") && !token.startsWith("<!")) {
      depth += 1;
    }
  }

  return lines.join("\n");
}

function renderContentPreview(content: string): ReactNode {
  if (!looksLikeXml(content)) {
    return content;
  }
  return content.split(/(<[^>]+>)/g).map((part, index) => {
    if (!part) {
      return null;
    }
    if (part.startsWith("<")) {
      return (
        <span className="text-[#8bd5ff]" key={index}>
          {part}
        </span>
      );
    }
    return (
      <span className="text-[#f0f2f7]" key={index}>
        {part}
      </span>
    );
  });
}

function rawPayloadJson(request: ModelRequestEvent): string {
  return JSON.stringify(
    {
      model: request.model,
      stream: request.responseMode !== "smooth",
      messages: request.messages,
      tools: request.tools,
    },
    null,
    2,
  );
}
