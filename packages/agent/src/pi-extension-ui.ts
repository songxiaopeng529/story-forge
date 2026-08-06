import type {
  ExtensionUIDialogOptions,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentEvent,
  ExtensionUiRequestEvent,
  ExtensionUiResponse,
  SessionId,
  TurnId,
} from "@story-forge/shared";

type PendingRequest = {
  turnId: TurnId;
  resolve(response: ExtensionUiResponse): void;
  cancel(): void;
};

type RequestInput =
  | { method: "select"; title: string; options: string[] }
  | { method: "confirm"; title: string; message: string }
  | { method: "input"; title: string; placeholder?: string }
  | { method: "editor"; title: string; prefill?: string };

export class PiExtensionUiBridge {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  createContext(input: {
    sessionId: SessionId;
    turnId: TurnId;
    signal: AbortSignal;
  }): ExtensionUIContext {
    const request = <T>(
      details: RequestInput,
      options: ExtensionUIDialogOptions | undefined,
      fallback: T,
      parse: (response: ExtensionUiResponse) => T,
    ) => this.request(input, details, options, fallback, parse);

    return {
      select: (title, options, dialogOptions) => request(
        {
          method: "select",
          title,
          options: options.filter((option) => !option.startsWith("Start fresh and implement")),
        },
        dialogOptions,
        undefined,
        (response) => response.cancelled || !options.includes(response.value ?? "")
          ? undefined
          : response.value,
      ),
      confirm: (title, message, dialogOptions) => request(
        { method: "confirm", title, message },
        dialogOptions,
        false,
        (response) => !response.cancelled && response.confirmed === true,
      ),
      input: (title, placeholder, dialogOptions) => request(
        {
          method: "input",
          title,
          ...(placeholder ? { placeholder } : {}),
        },
        dialogOptions,
        undefined,
        (response) => response.cancelled ? undefined : response.value,
      ),
      editor: (title, prefill) => request(
        {
          method: "editor",
          title,
          ...(prefill ? { prefill } : {}),
        },
        undefined,
        undefined,
        (response) => response.cancelled ? undefined : response.value,
      ),
      notify: (message, level = "info") => {
        this.emit({
          type: "extension.notification",
          sessionId: input.sessionId,
          turnId: input.turnId,
          message,
          level,
        });
      },
      onTerminalInput: () => () => undefined,
      setStatus: (key, text) => {
        this.emit({
          type: "extension.status",
          sessionId: input.sessionId,
          turnId: input.turnId,
          key,
          ...(text ? { text } : {}),
        });
      },
      setWorkingMessage: () => undefined,
      setWorkingVisible: () => undefined,
      setWorkingIndicator: () => undefined,
      setHiddenThinkingLabel: () => undefined,
      setWidget: (key, content) => {
        if (content !== undefined && !Array.isArray(content)) {
          return;
        }
        this.emit({
          type: "extension.widget",
          sessionId: input.sessionId,
          turnId: input.turnId,
          key,
          ...(content ? { lines: content } : {}),
        });
      },
      setFooter: () => undefined,
      setHeader: () => undefined,
      setTitle: () => undefined,
      custom: async <T>() => undefined as T,
      pasteToEditor: () => undefined,
      setEditorText: () => undefined,
      getEditorText: () => "",
      addAutocompleteProvider: () => undefined,
      setEditorComponent: () => undefined,
      getEditorComponent: () => undefined,
      theme: plainTheme,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is unavailable in StoryForge" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => undefined,
    };
  }

  respond(response: ExtensionUiResponse): void {
    this.pending.get(response.requestId)?.resolve(response);
  }

  cancelTurn(turnId: TurnId): void {
    for (const pending of this.pending.values()) {
      if (pending.turnId === turnId) {
        pending.cancel();
      }
    }
  }

  private request<T>(
    context: { sessionId: SessionId; turnId: TurnId; signal: AbortSignal },
    input: RequestInput,
    options: ExtensionUIDialogOptions | undefined,
    fallback: T,
    parse: (response: ExtensionUiResponse) => T,
  ): Promise<T> {
    if (context.signal.aborted || options?.signal?.aborted) {
      return Promise.resolve(fallback);
    }

    const requestId = createExtensionUiRequestId();
    return new Promise<T>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: T) => {
        if (!this.pending.has(requestId)) {
          return;
        }
        this.pending.delete(requestId);
        context.signal.removeEventListener("abort", cancel);
        options?.signal?.removeEventListener("abort", cancel);
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve(value);
      };
      const cancel = () => finish(fallback);
      this.pending.set(requestId, {
        turnId: context.turnId,
        resolve: (response) => finish(parse(response)),
        cancel,
      });
      context.signal.addEventListener("abort", cancel, { once: true });
      options?.signal?.addEventListener("abort", cancel, { once: true });
      if (options?.timeout) {
        timeout = setTimeout(cancel, options.timeout);
      }
      this.emit({
        type: "extension.ui.request",
        sessionId: context.sessionId,
        turnId: context.turnId,
        requestId,
        ...input,
      } as ExtensionUiRequestEvent);
    });
  }
}

const passthrough = (text: string) => text;
const plainTheme = {
  fg: (_color: string, text: string) => passthrough(text),
  bg: (_color: string, text: string) => passthrough(text),
  bold: passthrough,
  italic: passthrough,
  underline: passthrough,
  inverse: passthrough,
  strikethrough: passthrough,
  getFgAnsi: () => "",
  getBgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => passthrough,
  getBashModeBorderColor: () => passthrough,
} as unknown as ExtensionUIContext["theme"];

function createExtensionUiRequestId(): string {
  return `sf_extension_ui_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
