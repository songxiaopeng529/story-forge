import {
  Blocks,
  BrainCircuit,
  CalendarClock,
  MessagesSquare,
  PanelLeftClose,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import appIcon from "../assets/icon.png";
import { useI18n } from "../i18n";

export type Page = "agent" | "models" | "automations" | "extensions" | "settings";

export function PrimaryNavigation(props: {
  page: Page;
  onChange: (page: Page) => void;
  collapsible: boolean;
  onCollapse: () => void;
}) {
  const t = useI18n();

  return (
    <aside className="flex flex-col items-center gap-3 bg-forge-nav py-4 text-white">
      <img
        alt="StoryForge"
        className="h-11 w-11 rounded-[10px] object-cover"
        draggable={false}
        src={appIcon}
      />
      <div className="h-px w-7 bg-white/10" />
      <nav className="flex flex-col items-center gap-2">
        <NavButton
          active={props.page === "agent"}
          icon={<MessagesSquare size={20} />}
          label={t.nav.agent}
          onClick={() => props.onChange("agent")}
        />
        <NavButton
          active={props.page === "models"}
          icon={<BrainCircuit size={20} />}
          label={t.nav.models}
          onClick={() => props.onChange("models")}
        />
        <NavButton
          active={props.page === "automations"}
          icon={<CalendarClock size={20} />}
          label={t.nav.automations}
          onClick={() => props.onChange("automations")}
        />
        <NavButton
          active={props.page === "extensions"}
          icon={<Blocks size={20} />}
          label={t.nav.extensions}
          onClick={() => props.onChange("extensions")}
        />
        <NavButton
          active={props.page === "settings"}
          icon={<Settings size={20} />}
          label={t.nav.settings}
          onClick={() => props.onChange("settings")}
        />
      </nav>
      {props.collapsible ? (
        <button
          aria-label={t.nav.collapseNavigation}
          className="mt-auto flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/[0.08] text-white/70 hover:bg-white/[0.14]"
          onClick={props.onCollapse}
          title={t.nav.collapseNavigation}
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
