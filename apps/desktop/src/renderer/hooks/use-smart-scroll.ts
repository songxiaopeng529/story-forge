import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type UIEventHandler,
} from "react";

const DEFAULT_FOLLOW_THRESHOLD = 80;
const PROGRAMMATIC_SCROLL_TIMEOUT_MS = 1_000;

export interface UseSmartScrollOptions {
  /** Number of distinct timeline items. Increases become the unread-item count. */
  itemCount: number;
  /** Changes whenever the active conversation changes. Conversation changes reset and follow. */
  sessionKey?: string | null | undefined;
  /**
   * Optional version for in-place content updates, such as a streaming message's
   * character count. This is also the fallback when ResizeObserver is unavailable.
   */
  contentVersion?: string | number | undefined;
  /** Changes when an action, such as sending a user message, must force following. */
  forceScrollKey?: string | number | undefined;
  followThreshold?: number | undefined;
  /** Overrides the operating system preference, primarily for embedding and tests. */
  reducedMotion?: boolean | undefined;
}

export interface ScrollToLatestOptions {
  behavior?: ScrollBehavior | undefined;
}

export interface SmartScrollState {
  containerRef: RefObject<HTMLDivElement | null>;
  sentinelRef: RefObject<HTMLDivElement | null>;
  /** Whether new content is currently allowed to keep the view at the bottom. */
  isPinned: boolean;
  /** Whether the viewport is currently within followThreshold of the bottom. */
  isAtBottom: boolean;
  /** Distinct timeline items received while the user was reading older content. */
  newItemsCount: number;
  handleScroll: UIEventHandler<HTMLDivElement>;
  /** Forces the viewport to the latest content and clears the unread count. */
  scrollToLatest: (options?: ScrollToLatestOptions) => void;
}

function distanceFromBottom(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
}

function scrollElementToBottom(element: HTMLElement, behavior: ScrollBehavior): void {
  if (typeof element.scrollTo === "function") {
    element.scrollTo({ behavior, top: element.scrollHeight });
    return;
  }

  // Older embedded browsers and jsdom may not implement Element.scrollTo.
  element.scrollTop = element.scrollHeight;
}

function systemPrefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useReducedMotion(override: boolean | undefined): boolean {
  const [systemPreference, setSystemPreference] = useState(systemPrefersReducedMotion);

  useEffect(() => {
    if (
      override !== undefined
      || typeof window === "undefined"
      || typeof window.matchMedia !== "function"
    ) {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setSystemPreference(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener?.("change", updatePreference);
    return () => mediaQuery.removeEventListener?.("change", updatePreference);
  }, [override]);

  return override ?? systemPreference;
}

export function useSmartScroll(options: UseSmartScrollOptions): SmartScrollState {
  const {
    itemCount,
    sessionKey,
    contentVersion,
    forceScrollKey,
    followThreshold = DEFAULT_FOLLOW_THRESHOLD,
    reducedMotion: reducedMotionOverride,
  } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const previousItemCountRef = useRef(itemCount);
  const currentItemCountRef = useRef(itemCount);
  const previousForceScrollKeyRef = useRef(forceScrollKey);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [isPinned, setIsPinned] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newItemsCount, setNewItemsCount] = useState(0);
  const reducedMotion = useReducedMotion(reducedMotionOverride);
  currentItemCountRef.current = itemCount;

  const setPinnedState = useCallback((pinned: boolean) => {
    pinnedRef.current = pinned;
    setIsPinned(pinned);
    setIsAtBottom(pinned);
    if (pinned) {
      setNewItemsCount(0);
    }
  }, []);

  const scrollToLatest = useCallback((scrollOptions?: ScrollToLatestOptions) => {
    setPinnedState(true);
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const requestedBehavior = scrollOptions?.behavior ?? "smooth";
    const behavior = reducedMotion && requestedBehavior === "smooth"
      ? "auto"
      : requestedBehavior;
    if (programmaticScrollTimerRef.current !== undefined) {
      clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = undefined;
    }
    programmaticScrollRef.current = behavior === "smooth";
    if (programmaticScrollRef.current) {
      programmaticScrollTimerRef.current = setTimeout(() => {
        programmaticScrollRef.current = false;
        programmaticScrollTimerRef.current = undefined;
        const currentElement = containerRef.current;
        if (!currentElement) {
          return;
        }
        const atBottom = distanceFromBottom(currentElement) <= followThreshold;
        pinnedRef.current = atBottom;
        setIsAtBottom(atBottom);
        setIsPinned(atBottom);
        if (atBottom) {
          setNewItemsCount(0);
        }
      }, PROGRAMMATIC_SCROLL_TIMEOUT_MS);
    }
    scrollElementToBottom(element, behavior);
  }, [followThreshold, reducedMotion, setPinnedState]);

  const followGrowingContent = useCallback(() => {
    if (!pinnedRef.current) {
      const element = containerRef.current;
      if (element) {
        setIsAtBottom(distanceFromBottom(element) <= followThreshold);
      }
      return;
    }

    const element = containerRef.current;
    if (element) {
      // Smooth scrolling on every streamed token makes the viewport lag behind.
      scrollElementToBottom(element, "auto");
      setIsAtBottom(true);
    }
  }, [followThreshold]);

  const handleScroll = useCallback<UIEventHandler<HTMLDivElement>>((event) => {
    const atBottom = distanceFromBottom(event.currentTarget) <= followThreshold;
    if (programmaticScrollRef.current) {
      setIsAtBottom(atBottom);
      if (!atBottom) {
        return;
      }
      programmaticScrollRef.current = false;
      if (programmaticScrollTimerRef.current !== undefined) {
        clearTimeout(programmaticScrollTimerRef.current);
        programmaticScrollTimerRef.current = undefined;
      }
    }
    pinnedRef.current = atBottom;
    setIsAtBottom(atBottom);
    setIsPinned(atBottom);
    if (atBottom) {
      setNewItemsCount(0);
    }
  }, [followThreshold]);

  useEffect(() => () => {
    if (programmaticScrollTimerRef.current !== undefined) {
      clearTimeout(programmaticScrollTimerRef.current);
    }
  }, []);

  // Direct manipulation wins over an in-flight smooth scroll. Without this,
  // intermediate scroll events are indistinguishable from the animation and
  // a user who immediately changes their mind can be pulled back to the end.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }

    const cancelProgrammaticScroll = () => {
      if (!programmaticScrollRef.current) {
        return;
      }
      programmaticScrollRef.current = false;
      if (programmaticScrollTimerRef.current !== undefined) {
        clearTimeout(programmaticScrollTimerRef.current);
        programmaticScrollTimerRef.current = undefined;
      }

      const atBottom = distanceFromBottom(element) <= followThreshold;
      pinnedRef.current = atBottom;
      setIsAtBottom(atBottom);
      setIsPinned(atBottom);
      if (atBottom) {
        setNewItemsCount(0);
      }
    };

    element.addEventListener("wheel", cancelProgrammaticScroll, { passive: true });
    element.addEventListener("touchstart", cancelProgrammaticScroll, { passive: true });
    return () => {
      element.removeEventListener("wheel", cancelProgrammaticScroll);
      element.removeEventListener("touchstart", cancelProgrammaticScroll);
    };
  }, [followThreshold]);

  // A new conversation always starts at its latest content.
  useLayoutEffect(() => {
    programmaticScrollRef.current = false;
    if (programmaticScrollTimerRef.current !== undefined) {
      clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = undefined;
    }
    previousItemCountRef.current = currentItemCountRef.current;
    setPinnedState(true);
    const element = containerRef.current;
    if (element) {
      scrollElementToBottom(element, "auto");
    }
  }, [sessionKey, setPinnedState]);

  // A caller can force following declaratively (normally when the user sends).
  useLayoutEffect(() => {
    if (Object.is(previousForceScrollKeyRef.current, forceScrollKey)) {
      return;
    }
    previousForceScrollKeyRef.current = forceScrollKey;
    scrollToLatest({ behavior: "auto" });
  }, [forceScrollKey, scrollToLatest]);

  useLayoutEffect(() => {
    const previousItemCount = previousItemCountRef.current;
    previousItemCountRef.current = itemCount;
    const addedItems = Math.max(0, itemCount - previousItemCount);

    if (!pinnedRef.current) {
      if (addedItems > 0) {
        setNewItemsCount((count) => count + addedItems);
      }
      return;
    }

    followGrowingContent();
  }, [itemCount, followGrowingContent]);

  // This dependency provides a deterministic fallback for environments without
  // ResizeObserver and an immediate update before an observer callback arrives.
  useLayoutEffect(() => {
    followGrowingContent();
  }, [contentVersion, followGrowingContent]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(followGrowingContent);
    const observeContent = () => {
      resizeObserver.disconnect();
      for (const child of Array.from(container.children)) {
        resizeObserver.observe(child);
      }

      const sentinel = sentinelRef.current;
      if (sentinel && sentinel.parentElement && sentinel.parentElement !== container) {
        resizeObserver.observe(sentinel.parentElement);
      }
    };

    observeContent();
    const mutationObserver = typeof MutationObserver === "undefined"
      ? undefined
      : new MutationObserver(observeContent);
    mutationObserver?.observe(container, { childList: true });

    return () => {
      mutationObserver?.disconnect();
      resizeObserver.disconnect();
    };
  }, [followGrowingContent]);

  return {
    containerRef,
    sentinelRef,
    isPinned,
    isAtBottom,
    newItemsCount,
    handleScroll,
    scrollToLatest,
  };
}
