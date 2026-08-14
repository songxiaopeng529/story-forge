// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSmartScroll } from "./use-smart-scroll";

interface HarnessProps {
  itemCount: number;
  sessionKey?: string | undefined;
  contentVersion?: number | undefined;
  forceScrollKey?: number | undefined;
  reducedMotion?: boolean | undefined;
}

function SmartScrollHarness(props: HarnessProps) {
  const smartScroll = useSmartScroll(props);

  return (
    <>
      <div
        data-testid="scroll-container"
        onScroll={smartScroll.handleScroll}
        ref={smartScroll.containerRef}
      >
        <div data-testid="timeline-content" />
        <div data-testid="bottom-sentinel" ref={smartScroll.sentinelRef} />
      </div>
      <output data-testid="pinned">{String(smartScroll.isPinned)}</output>
      <output data-testid="at-bottom">{String(smartScroll.isAtBottom)}</output>
      <output data-testid="new-items">{smartScroll.newItemsCount}</output>
      <button onClick={() => smartScroll.scrollToLatest()} type="button">
        Latest
      </button>
    </>
  );
}

function configureScrollGeometry(element: HTMLElement, values: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}) {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: values.clientHeight },
    scrollHeight: { configurable: true, value: values.scrollHeight },
    scrollTop: { configurable: true, value: values.scrollTop, writable: true },
  });
}

describe("useSmartScroll", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps following when the viewport is within 80px of the bottom", () => {
    const { rerender } = render(<SmartScrollHarness itemCount={1} sessionKey="session-a" />);
    const container = screen.getByTestId("scroll-container");
    configureScrollGeometry(container, { clientHeight: 400, scrollHeight: 1_000, scrollTop: 530 });
    const scrollTo = vi.fn();
    Object.defineProperty(container, "scrollTo", { configurable: true, value: scrollTo });

    fireEvent.scroll(container);
    expect(screen.getByTestId("pinned")).toHaveTextContent("true");

    rerender(<SmartScrollHarness itemCount={2} sessionKey="session-a" />);

    expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1_000 });
    expect(screen.getByTestId("new-items")).toHaveTextContent("0");
  });

  it("does not steal the viewport when the user scrolls up", () => {
    const { rerender } = render(<SmartScrollHarness itemCount={1} sessionKey="session-a" />);
    const container = screen.getByTestId("scroll-container");
    configureScrollGeometry(container, { clientHeight: 400, scrollHeight: 1_000, scrollTop: 100 });
    const scrollTo = vi.fn();
    Object.defineProperty(container, "scrollTo", { configurable: true, value: scrollTo });

    fireEvent.scroll(container);
    expect(screen.getByTestId("pinned")).toHaveTextContent("false");
    expect(screen.getByTestId("at-bottom")).toHaveTextContent("false");

    rerender(<SmartScrollHarness contentVersion={20} itemCount={1} sessionKey="session-a" />);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("counts distinct items received while unpinned", () => {
    const { rerender } = render(<SmartScrollHarness itemCount={2} sessionKey="session-a" />);
    const container = screen.getByTestId("scroll-container");
    configureScrollGeometry(container, { clientHeight: 400, scrollHeight: 1_000, scrollTop: 100 });
    fireEvent.scroll(container);

    rerender(<SmartScrollHarness itemCount={5} sessionKey="session-a" />);

    expect(screen.getByTestId("new-items")).toHaveTextContent("3");
    expect(screen.getByTestId("pinned")).toHaveTextContent("false");
  });

  it("returns to the latest content, clears the count, and respects reduced motion", () => {
    const { rerender } = render(
      <SmartScrollHarness itemCount={1} reducedMotion sessionKey="session-a" />,
    );
    const container = screen.getByTestId("scroll-container");
    configureScrollGeometry(container, { clientHeight: 400, scrollHeight: 1_000, scrollTop: 100 });
    const scrollTo = vi.fn();
    Object.defineProperty(container, "scrollTo", { configurable: true, value: scrollTo });
    fireEvent.scroll(container);
    rerender(<SmartScrollHarness itemCount={2} reducedMotion sessionKey="session-a" />);
    expect(screen.getByTestId("new-items")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "Latest" }));

    expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1_000 });
    expect(screen.getByTestId("new-items")).toHaveTextContent("0");
    expect(screen.getByTestId("pinned")).toHaveTextContent("true");
  });

  it("does not treat intermediate smooth-scroll events as a user scroll", () => {
    const { rerender } = render(<SmartScrollHarness itemCount={1} sessionKey="session-a" />);
    const container = screen.getByTestId("scroll-container");
    configureScrollGeometry(container, { clientHeight: 400, scrollHeight: 1_000, scrollTop: 100 });
    const scrollTo = vi.fn();
    Object.defineProperty(container, "scrollTo", { configurable: true, value: scrollTo });
    fireEvent.scroll(container);

    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    container.scrollTop = 300;
    fireEvent.scroll(container);
    expect(screen.getByTestId("pinned")).toHaveTextContent("true");

    rerender(
      <SmartScrollHarness contentVersion={2} itemCount={1} sessionKey="session-a" />,
    );
    expect(scrollTo).toHaveBeenLastCalledWith({ behavior: "auto", top: 1_000 });
  });

  it("lets direct wheel input cancel an in-flight smooth scroll", () => {
    const { rerender } = render(<SmartScrollHarness itemCount={1} sessionKey="session-a" />);
    const container = screen.getByTestId("scroll-container");
    configureScrollGeometry(container, { clientHeight: 400, scrollHeight: 1_000, scrollTop: 100 });
    const scrollTo = vi.fn();
    Object.defineProperty(container, "scrollTo", { configurable: true, value: scrollTo });
    fireEvent.scroll(container);

    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    container.scrollTop = 300;
    fireEvent.wheel(container);
    expect(screen.getByTestId("pinned")).toHaveTextContent("false");

    rerender(
      <SmartScrollHarness contentVersion={2} itemCount={1} sessionKey="session-a" />,
    );
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 1_000 });
  });

  it("follows streaming height changes reported by ResizeObserver only while pinned", () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      disconnect = vi.fn();
      observe = observe;
      unobserve = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    render(<SmartScrollHarness itemCount={1} sessionKey="session-a" />);
    const container = screen.getByTestId("scroll-container");
    configureScrollGeometry(container, { clientHeight: 400, scrollHeight: 1_000, scrollTop: 600 });
    const scrollTo = vi.fn();
    Object.defineProperty(container, "scrollTo", { configurable: true, value: scrollTo });

    expect(observe).toHaveBeenCalledWith(screen.getByTestId("timeline-content"));
    act(() => resizeCallback?.([], {} as ResizeObserver));
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1_000 });

    scrollTo.mockClear();
    container.scrollTop = 100;
    fireEvent.scroll(container);
    act(() => resizeCallback?.([], {} as ResizeObserver));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("forces the latest content when the conversation changes", () => {
    const { rerender } = render(<SmartScrollHarness itemCount={2} sessionKey="session-a" />);
    const container = screen.getByTestId("scroll-container");
    configureScrollGeometry(container, { clientHeight: 400, scrollHeight: 1_000, scrollTop: 100 });
    const scrollTo = vi.fn();
    Object.defineProperty(container, "scrollTo", { configurable: true, value: scrollTo });
    fireEvent.scroll(container);

    rerender(<SmartScrollHarness itemCount={4} sessionKey="session-b" />);

    expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1_000 });
    expect(screen.getByTestId("new-items")).toHaveTextContent("0");
    expect(screen.getByTestId("pinned")).toHaveTextContent("true");
  });
});
