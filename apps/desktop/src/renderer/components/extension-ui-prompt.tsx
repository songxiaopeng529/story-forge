import type { ExtensionUiRequestEvent, ExtensionUiResponse } from "@story-forge/shared";
import { useEffect, useState } from "react";

export function ExtensionUiPrompt(props: {
  request: ExtensionUiRequestEvent;
  responding: boolean;
  onRespond: (response: Omit<ExtensionUiResponse, "requestId">) => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(props.request.method === "editor" ? props.request.prefill ?? "" : "");
  }, [props.request.requestId]);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-950/25 px-4 py-24">
      <section
        aria-labelledby="extension-ui-title"
        className="w-full max-w-2xl rounded-lg border border-forge-line bg-white p-5 shadow-xl"
        role="dialog"
      >
        <h2 className="whitespace-pre-wrap break-words text-base font-semibold text-forge-ink" id="extension-ui-title">
          {props.request.title}
        </h2>

        {props.request.method === "select" ? (
          <div className="mt-4 grid max-h-[55vh] gap-2 overflow-y-auto pr-1" role="listbox">
            {props.request.options.map((option) => (
              <button
                className="w-full rounded-md border border-forge-line px-3 py-2.5 text-left text-sm text-forge-ink hover:border-forge-ink/40 hover:bg-forge-canvas disabled:opacity-60"
                disabled={props.responding}
                key={option}
                onClick={() => props.onRespond({ value: option })}
                role="option"
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}

        {props.request.method === "confirm" ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-forge-muted">
            {props.request.message}
          </p>
        ) : null}

        {props.request.method === "input" ? (
          <input
            autoFocus
            className="mt-4 w-full rounded-md border border-forge-line px-3 py-2 text-sm outline-none focus:border-forge-ink/50"
            onChange={(event) => setValue(event.currentTarget.value)}
            placeholder={props.request.placeholder}
            value={value}
          />
        ) : null}

        {props.request.method === "editor" ? (
          <textarea
            autoFocus
            className="mt-4 h-40 w-full resize-y rounded-md border border-forge-line px-3 py-2 text-sm leading-6 outline-none focus:border-forge-ink/50"
            onChange={(event) => setValue(event.currentTarget.value)}
            value={value}
          />
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-md border border-forge-line px-4 py-2 text-sm font-medium text-forge-muted hover:bg-forge-canvas disabled:opacity-60"
            disabled={props.responding}
            onClick={() => props.onRespond({ cancelled: true })}
            type="button"
          >
            Cancel
          </button>
          {props.request.method === "confirm" ? (
            <button
              className="rounded-md bg-forge-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              disabled={props.responding}
              onClick={() => props.onRespond({ confirmed: true })}
              type="button"
            >
              Confirm
            </button>
          ) : null}
          {props.request.method === "input" || props.request.method === "editor" ? (
            <button
              className="rounded-md bg-forge-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              disabled={props.responding || !value.trim()}
              onClick={() => props.onRespond({ value: value.trim() })}
              type="button"
            >
              Submit
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
