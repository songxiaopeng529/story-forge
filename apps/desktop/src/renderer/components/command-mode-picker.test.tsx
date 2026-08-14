import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandModePicker } from "./command-mode-picker";

afterEach(() => {
  cleanup();
});

describe("CommandModePicker", () => {
  it("opens with the current mode selected and changes modes with the mouse", () => {
    const onChange = vi.fn();
    render(<CommandModePicker onChange={onChange} value="sentinel" />);

    const trigger = screen.getByRole("button", { name: "Sentinel mode" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Command mode" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Sentinel mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Cruise mode" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Cruise mode" }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("cruise");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("supports roving focus, wrapping, Home, End, and keyboard selection", () => {
    const onChange = vi.fn();
    render(<CommandModePicker onChange={onChange} value="sentinel" />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Sentinel mode" }), {
      key: "ArrowDown",
    });

    const sentinel = screen.getByRole("menuitemradio", { name: "Sentinel mode" });
    const cruise = screen.getByRole("menuitemradio", { name: "Cruise mode" });
    const unleashed = screen.getByRole("menuitemradio", { name: "Unleashed mode" });
    expect(sentinel).toHaveFocus();

    fireEvent.keyDown(sentinel, { key: "ArrowUp" });
    expect(unleashed).toHaveFocus();
    fireEvent.keyDown(unleashed, { key: "Home" });
    expect(sentinel).toHaveFocus();
    fireEvent.keyDown(sentinel, { key: "End" });
    expect(unleashed).toHaveFocus();
    fireEvent.keyDown(unleashed, { key: "ArrowDown" });
    expect(sentinel).toHaveFocus();
    fireEvent.keyDown(sentinel, { key: "ArrowDown" });
    expect(cruise).toHaveFocus();
    fireEvent.keyDown(cruise, { key: " " });

    expect(onChange).toHaveBeenCalledWith("cruise");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and restores focus to the trigger", () => {
    render(<CommandModePicker onChange={vi.fn()} value="cruise" />);
    const trigger = screen.getByRole("button", { name: "Cruise mode" });

    fireEvent.click(trigger);
    const selectedOption = screen.getByRole("menuitemradio", { name: "Cruise mode" });
    expect(selectedOption).toHaveFocus();

    fireEvent.keyDown(selectedOption, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when the user presses outside the picker", () => {
    const onOpenChange = vi.fn();
    render(
      <CommandModePicker
        onChange={vi.fn()}
        onOpenChange={onOpenChange}
        value="sentinel"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sentinel mode" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("supports parent-controlled open state", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <CommandModePicker
        onChange={vi.fn()}
        onOpenChange={onOpenChange}
        open={false}
        value="sentinel"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sentinel mode" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    rerender(
      <CommandModePicker
        onChange={vi.fn()}
        onOpenChange={onOpenChange}
        open
        value="sentinel"
      />,
    );
    expect(screen.getByRole("menu")).toBeInTheDocument();

    rerender(
      <CommandModePicker
        onChange={vi.fn()}
        onOpenChange={onOpenChange}
        open={false}
        value="sentinel"
      />,
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not open or change while disabled", () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CommandModePicker
        disabled
        onChange={onChange}
        onOpenChange={onOpenChange}
        value="unleashed"
      />,
    );

    const trigger = screen.getByRole("button", { name: "Unleashed mode" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a parent-controlled menu hidden when disabled", () => {
    const onOpenChange = vi.fn();
    render(
      <CommandModePicker
        disabled
        onChange={vi.fn()}
        onOpenChange={onOpenChange}
        open
        value="cruise"
      />,
    );

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cruise mode" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays focusable but blocks interaction while a mode save is busy", () => {
    const onChange = vi.fn();
    render(<CommandModePicker busy onChange={onChange} value="cruise" />);

    const trigger = screen.getByRole("button", { name: "Cruise mode" });
    trigger.focus();
    expect(trigger).toBeEnabled();
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
