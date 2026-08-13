import type { CommandExecutionMode } from "@story-forge/shared";
import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { useI18n } from "../i18n";

const COMMAND_MODES = ["sentinel", "cruise", "unleashed"] as const satisfies readonly CommandExecutionMode[];
const OPTION_HEIGHT_PX = 30;

export type CommandModePickerProps = {
  value: CommandExecutionMode;
  disabled?: boolean;
  busy?: boolean;
  disabledReason?: string;
  open?: boolean;
  onChange: (value: CommandExecutionMode) => void;
  onOpenChange?: (open: boolean) => void;
  triggerRef?: Ref<HTMLButtonElement>;
};

export function CommandModePicker(props: CommandModePickerProps) {
  const t = useI18n();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const internalTriggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [internalOpen, setInternalOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => modeIndex(props.value));
  const controlled = props.open !== undefined;
  const requestedOpen = controlled ? props.open : internalOpen;
  const interactionDisabled = Boolean(props.disabled || props.busy);
  const open = !interactionDisabled && requestedOpen;
  const activeMode = COMMAND_MODES[activeIndex] ?? props.value;

  const setOpen = (nextOpen: boolean) => {
    if (!controlled) {
      setInternalOpen(nextOpen);
    }
    props.onOpenChange?.(nextOpen);
  };

  const focusOption = (nextIndex: number) => {
    const boundedIndex = (nextIndex + COMMAND_MODES.length) % COMMAND_MODES.length;
    setActiveIndex(boundedIndex);
    optionRefs.current[boundedIndex]?.focus();
  };

  const selectMode = (mode: CommandExecutionMode) => {
    if (interactionDisabled) {
      return;
    }

    if (mode !== props.value) {
      props.onChange(mode);
    }
    setOpen(false);
    internalTriggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const selectedIndex = modeIndex(props.value);
    setActiveIndex(selectedIndex);
    optionRefs.current[selectedIndex]?.focus();
  }, [open, props.value]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [controlled, open, props.onOpenChange]);

  useEffect(() => {
    if (interactionDisabled && requestedOpen) {
      setOpen(false);
    }
  }, [controlled, interactionDisabled, props.onOpenChange, requestedOpen]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (interactionDisabled || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) {
      return;
    }

    event.preventDefault();
    setActiveIndex(modeIndex(props.value));
    setOpen(true);
  };

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    mode: CommandExecutionMode,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(activeIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(activeIndex - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusOption(COMMAND_MODES.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectMode(mode);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      internalTriggerRef.current?.focus();
    }
  };

  return (
    <div
      className="relative inline-flex"
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
      ref={rootRef}
    >
      <button
        aria-controls={open ? menuId : undefined}
        aria-disabled={props.busy || undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`motion-interactive inline-flex h-7 items-center gap-1 rounded-[8px] px-1.5 text-[12px] font-medium outline-none hover:bg-forge-canvas focus-visible:ring-2 focus-visible:ring-forge-ink/15 disabled:cursor-not-allowed disabled:opacity-50 ${
          props.value === "unleashed"
            ? "text-forge-danger hover:bg-forge-danger-bg"
            : "text-forge-ink"
        }`}
        disabled={props.disabled}
        onClick={() => {
          if (!interactionDisabled) {
            setOpen(!open);
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        ref={(node) => {
          internalTriggerRef.current = node;
          setRef(props.triggerRef, node);
        }}
        title={props.disabledReason ?? t.commandMode[props.value].description}
        type="button"
      >
        <span>{t.commandMode[props.value].chip}</span>
        <ChevronDown
          aria-hidden="true"
          className={`motion-interactive -mr-0.5 ${open ? "rotate-180" : ""}`}
          size={13}
          strokeWidth={2}
        />
      </button>

      {open ? (
        <div
          aria-label={t.commandMode[props.value].label}
          aria-orientation="vertical"
          className="motion-popover absolute bottom-full right-0 z-50 mb-2 w-44 overflow-hidden rounded-[10px] border border-forge-line bg-white p-1 shadow-[0_12px_36px_rgba(15,23,42,0.14)]"
          id={menuId}
          role="menu"
        >
          <div
            aria-hidden="true"
            className={`motion-interactive pointer-events-none absolute left-1 right-1 top-1 h-[30px] rounded-[6px] ${
              activeMode === "unleashed" ? "bg-forge-danger-bg" : "bg-forge-canvas"
            }`}
            style={{ transform: `translateY(${activeIndex * OPTION_HEIGHT_PX}px)` }}
          />

          {COMMAND_MODES.map((mode, index) => {
            const selected = props.value === mode;
            const danger = mode === "unleashed";
            const descriptionId = `${menuId}-${mode}-description`;

            return (
              <button
                aria-checked={selected}
                aria-describedby={descriptionId}
                aria-label={t.commandMode[mode].chip}
                className={`relative flex h-[30px] w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forge-ink/15 ${
                  danger ? "text-forge-danger" : "text-forge-ink"
                }`}
                key={mode}
                onClick={() => selectMode(mode)}
                onKeyDown={(event) => handleOptionKeyDown(event, mode)}
                onMouseEnter={() => setActiveIndex(index)}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                role="menuitemradio"
                tabIndex={activeIndex === index ? 0 : -1}
                title={t.commandMode[mode].description}
                type="button"
              >
                <span className="min-w-0 flex-1 truncate">{t.commandMode[mode].chip}</span>
                <span className="shrink-0 text-[10.5px] font-normal text-forge-muted">
                  {t.commandMode[mode].approval}
                </span>
                <span className="sr-only" id={descriptionId}>
                  {t.commandMode[mode].approval}. {t.commandMode[mode].description}
                </span>
                <Check
                  aria-hidden="true"
                  className={`motion-interactive ${selected ? "opacity-100 scale-100" : "opacity-0 scale-75"}`}
                  size={14}
                  strokeWidth={2.25}
                />
              </button>
            );
          })}
          <div className="mt-1 border-t border-forge-line px-2 pb-1 pt-1.5 text-[10.5px] leading-4 text-forge-muted">
            {t.agent.commandModeAppliesToNewTurns}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function modeIndex(mode: CommandExecutionMode): number {
  return COMMAND_MODES.indexOf(mode);
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    ref.current = value;
  }
}
