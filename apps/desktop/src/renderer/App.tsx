import { Bot, FolderOpen, KeyRound, Play, Settings, TerminalSquare } from "lucide-react";
import { useState } from "react";

const runtimeItems = [
  { label: "Runtime", value: "Native Loop" },
  { label: "Tools", value: "Workspace read/list" },
  { label: "Memory", value: "In-memory" },
  { label: "MCP", value: "Disabled" },
];

export function App() {
  const [prompt, setPrompt] = useState("");
  const [events, setEvents] = useState<unknown[]>([]);

  async function runAgent(): Promise<void> {
    const nextEvents = await window.storyForge.runTurn({
      workspaceRoot: "/Users/bytedance/Desktop/code/story-forge",
      providerConfig: {
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
      },
      prompt,
    });
    setEvents(nextEvents);
  }

  return (
    <main className="grid h-screen grid-cols-[280px_1fr] bg-forge-canvas text-forge-ink">
      <aside className="border-r border-forge-line bg-white px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-forge-ink text-white">
            <Bot size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-6">StoryForge</h1>
            <p className="text-sm text-slate-600">Coding agent desktop</p>
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          <button className="flex h-10 w-full items-center gap-3 rounded-md bg-forge-ink px-3 text-left text-sm font-medium text-white">
            <TerminalSquare size={16} aria-hidden="true" />
            Agent Core
          </button>
          <button className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-slate-700 hover:bg-slate-100">
            <FolderOpen size={16} aria-hidden="true" />
            Workspace
          </button>
          <button className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-slate-700 hover:bg-slate-100">
            <KeyRound size={16} aria-hidden="true" />
            Models
          </button>
          <button className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-slate-700 hover:bg-slate-100">
            <Settings size={16} aria-hidden="true" />
            Settings
          </button>
        </nav>
      </aside>

      <section className="flex min-w-0 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-forge-line bg-white px-6">
          <div>
            <h2 className="text-base font-semibold">Native Agent Session</h2>
            <p className="text-sm text-slate-600">Local workspace runner</p>
          </div>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-forge-ember px-3 text-sm font-medium text-white hover:bg-[#a93d27]"
            onClick={() => void runAgent()}
            type="button"
          >
            <Play size={16} aria-hidden="true" />
            Run
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col p-6">
            <div className="flex-1 overflow-auto rounded-md border border-forge-line bg-white p-4">
              {events.length === 0 ? (
                <div className="rounded-md bg-slate-100 p-4 text-sm text-slate-700">
                  StoryForge is ready for a workspace, a model provider, and a first native agent turn.
                </div>
              ) : (
                <pre className="whitespace-pre-wrap text-xs text-slate-700">{JSON.stringify(events, null, 2)}</pre>
              )}
            </div>

            <label className="mt-4 block">
              <span className="sr-only">Agent prompt</span>
              <textarea
                className="h-28 w-full resize-none rounded-md border border-forge-line bg-white p-3 text-sm outline-none ring-forge-ember focus:ring-2"
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask StoryForge to inspect, explain, or change code..."
                value={prompt}
              />
            </label>
          </div>

          <aside className="border-l border-forge-line bg-white p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Runtime Map</h3>
            <div className="mt-4 space-y-3">
              {runtimeItems.map((item) => (
                <div key={item.label} className="rounded-md border border-forge-line bg-forge-canvas p-3">
                  <div className="text-xs font-medium uppercase text-slate-500">{item.label}</div>
                  <div className="mt-1 text-sm font-semibold">{item.value}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
