import {
  Bot,
  CalendarClock,
  KeyRound,
  PanelLeftClose,
  Puzzle,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";

export type Page = "agent" | "models" | "automations" | "extensions" | "settings";

export function PrimaryNavigation(props: {
  page: Page;
  onChange: (page: Page) => void;
  collapsible: boolean;
  onCollapse: () => void;
}) {
  return (
    <aside className="flex flex-col items-center gap-3 bg-forge-nav py-4 text-white">
      <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-white text-[13px] font-semibold text-forge-ink">
        SF
      </div>
      <div className="h-px w-7 bg-white/10" />
      <nav className="flex flex-col items-center gap-2">
        <NavButton
          active={props.page === "agent"}
          icon={<Bot size={20} />}
          label="Coding Agent"
          onClick={() => props.onChange("agent")}
        />
        <NavButton
          active={props.page === "models"}
          icon={<KeyRound size={20} />}
          label="Models"
          onClick={() => props.onChange("models")}
        />
        <NavButton
          active={props.page === "automations"}
          icon={<CalendarClock size={20} />}
          label="Automations"
          onClick={() => props.onChange("automations")}
        />
        <NavButton
          active={props.page === "extensions"}
          icon={<Puzzle size={20} />}
          label="MCP & Skills"
          onClick={() => props.onChange("extensions")}
        />
        <NavButton
          active={props.page === "settings"}
          icon={<Settings size={20} />}
          label="Settings"
          onClick={() => props.onChange("settings")}
        />
      </nav>
      {props.collapsible ? (
        <button
          aria-label="Collapse navigation"
          className="mt-auto flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/[0.08] text-white/70 hover:bg-white/[0.14]"
          onClick={props.onCollapse}
          title="Collapse navigation"
          type="button"
        >
          <PanelLeftClose size={16} />
        </button>
      ) : null}
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
      aria-label={props.label}
      className={`flex h-11 w-11 items-center justify-center rounded-[10px] ${
        props.active
          ? "bg-white text-forge-ink"
          : "text-white/70 hover:bg-white/10 hover:text-white"
      }`}
      onClick={props.onClick}
      title={props.label}
      type="button"
    >
      {props.icon}
    </button>
  );
}
