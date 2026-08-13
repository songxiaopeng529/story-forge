import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTypewriterText } from "./use-typewriter-text";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useTypewriterText", () => {
  it("keeps the visible prefix when streamed text is appended", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useTypewriterText(text, true, 10),
      { initialProps: { text: "abc" } },
    );

    expect(result.current).toBe("");

    act(() => vi.advanceTimersByTime(20));
    expect(result.current).toBe("ab");

    rerender({ text: "abcdef" });
    expect(result.current).toBe("ab");

    act(() => vi.advanceTimersByTime(40));
    expect(result.current).toBe("abcdef");
  });

  it("continues advancing while deltas arrive faster than the character delay", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useTypewriterText(text, true, 10),
      { initialProps: { text: "a" } },
    );

    rerender({ text: "ab" });
    rerender({ text: "abc" });
    rerender({ text: "abcd" });
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(10));
    expect(result.current).toBe("a");

    rerender({ text: "abcde" });
    rerender({ text: "abcdef" });
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(50));
    expect(result.current).toBe("abcdef");
  });

  it("catches up with a large streamed backlog within a bounded time", () => {
    const content = "x".repeat(1_000);
    const { result } = renderHook(() => useTypewriterText(content, true, 10));

    act(() => vi.advanceTimersByTime(1_000));

    expect(result.current).toBe(content);
  });

  it("snaps to the target while disabled and resumes from that text when re-enabled", () => {
    const { result, rerender } = renderHook(
      ({ enabled, text }) => useTypewriterText(text, enabled, 10),
      { initialProps: { enabled: true, text: "agent" } },
    );

    act(() => vi.advanceTimersByTime(10));
    expect(result.current).toBe("a");

    rerender({ enabled: false, text: "agent" });
    expect(result.current).toBe("agent");
    expect(vi.getTimerCount()).toBe(0);

    rerender({ enabled: true, text: "agent" });
    expect(result.current).toBe("agent");
    expect(vi.getTimerCount()).toBe(0);

    rerender({ enabled: true, text: "agents" });
    expect(result.current).toBe("agent");

    act(() => vi.advanceTimersByTime(10));
    expect(result.current).toBe("agents");
  });

  it("truncates shortened text immediately and animates only a replacement suffix", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useTypewriterText(text, true, 10),
      { initialProps: { text: "hello world" } },
    );

    act(() => vi.runAllTimers());
    expect(result.current).toBe("hello world");

    rerender({ text: "hello" });
    expect(result.current).toBe("hello");
    expect(vi.getTimerCount()).toBe(0);

    rerender({ text: "help" });
    expect(result.current).toBe("hel");

    act(() => vi.advanceTimersByTime(10));
    expect(result.current).toBe("help");
  });

  it("reveals astral Unicode characters as a single visible character", () => {
    const { result } = renderHook(() => useTypewriterText("🤖!", true, 10));

    act(() => vi.advanceTimersByTime(10));
    expect(result.current).toBe("🤖");

    act(() => vi.advanceTimersByTime(10));
    expect(result.current).toBe("🤖!");
  });

  it("clears its pending timer when unmounted", () => {
    const { unmount } = renderHook(() => useTypewriterText("still streaming", true, 10));

    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);

    act(() => vi.runAllTimers());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reveals text immediately when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    const { result } = renderHook(() => useTypewriterText("No animation", true, 10));

    expect(result.current).toBe("No animation");
    expect(vi.getTimerCount()).toBe(0);
  });
});
