import { Bot, KeyRound, Puzzle, Settings } from "lucide-react";
import type { ReactNode } from "react";

export type Page = "agent" | "models" | "extensions" | "settings";

export function PrimaryNavigation(props: {
  page: Page;
  onChange: (page: Page) => void;
}) {
  return (
    <aside className="border-r border-forge-line bg-[#17202a] px-4 py-5 text-white">
      <div className="flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-forge-ember">
          <Bot size={20} aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-6">StoryForge</h1>
          <p className="text-xs text-slate-300">Coding agent</p>
        </div>
      </div>
      <nav className="mt-8 space-y-1">
        <NavButton
          active={props.page === "agent"}
          icon={<Bot size={17} />}
          label="Coding Agent"
          onClick={() => props.onChange("agent")}
        />
        <NavButton
          active={props.page === "models"}
          icon={<KeyRound size={17} />}
          label="Models"
          onClick={() => props.onChange("models")}
        />
        <NavButton
          active={props.page === "extensions"}
          icon={<Puzzle size={17} />}
          label="MCP & Skills"
          onClick={() => props.onChange("extensions")}
        />
        <div className="mt-6 border-t border-white/10 pt-4">
          <NavButton
            active={props.page === "settings"}
            icon={<Settings size={17} />}
            label="Settings"
            onClick={() => props.onChange("settings")}
          />
        </div>
      </nav>
    </aside>
  );
}

function NavButton(props: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium ${
        props.active ? "bg-white text-forge-ink" : "text-slate-300 hover:bg-white/10"
      }`}
      onClick={props.onClick}
      type="button"
    >
      {props.icon}
      {props.label}
    </button>
  );
}
