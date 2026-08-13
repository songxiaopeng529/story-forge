import { useEffect, useRef, useState } from "react";

function commonPrefix(left: string, right: string): string {
  let length = 0;

  while (length < left.length && length < right.length && left[length] === right[length]) {
    length += 1;
  }

  // Do not leave the visible value ending on half of a surrogate pair when two
  // different emoji happen to share the same leading UTF-16 code unit.
  if (length > 0) {
    const lastCodeUnit = left.charCodeAt(length - 1);
    if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
      length -= 1;
    }
  }

  return left.slice(0, length);
}

function nextCharacterEnd(text: string, start: number): number {
  const codePoint = text.codePointAt(start);
  return start + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
}

function nextRevealEnd(text: string, start: number): number {
  const backlog = text.length - start;
  const batchSize = backlog > 128
    ? Math.ceil(backlog / 8)
    : backlog > 96
      ? 12
      : backlog > 48
        ? 6
        : backlog > 24
          ? 3
          : 1;
  let end = start;
  for (let index = 0; index < batchSize && end < text.length; index += 1) {
    end = nextCharacterEnd(text, end);
  }
  return end;
}

function systemPrefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useTypewriterText(text: string, enabled: boolean, delayMs = 12): string {
  const [reducedMotion, setReducedMotion] = useState(() => enabled && systemPrefersReducedMotion());
  const shouldAnimate = enabled && !reducedMotion;
  const [visible, setVisible] = useState(shouldAnimate ? "" : text);
  const visibleRef = useRef(visible);
  const targetRef = useRef(text);
  const enabledRef = useRef(enabled);
  const delayRef = useRef(delayMs);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  targetRef.current = text;
  enabledRef.current = shouldAnimate;
  delayRef.current = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };

    const scheduleNextCharacter = () => {
      if (
        timerRef.current !== undefined
        || !enabledRef.current
        || visibleRef.current === targetRef.current
      ) {
        return;
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        if (!enabledRef.current) {
          return;
        }

        const target = targetRef.current;
        let current = visibleRef.current;
        if (!target.startsWith(current)) {
          current = commonPrefix(current, target);
        }

        const end = nextRevealEnd(target, current.length);
        const next = target.slice(0, end);
        visibleRef.current = next;
        setVisible(next);
        scheduleNextCharacter();
      }, delayRef.current);
    };

    if (!shouldAnimate) {
      clearTimer();
      visibleRef.current = text;
      setVisible(text);
      return;
    }

    let nextVisible = visibleRef.current;
    if (!text.startsWith(nextVisible)) {
      nextVisible = commonPrefix(nextVisible, text);
      visibleRef.current = nextVisible;
      setVisible(nextVisible);
    }

    if (nextVisible === text) {
      clearTimer();
      return;
    }

    scheduleNextCharacter();
  }, [delayMs, shouldAnimate, text]);

  useEffect(() => {
    if (!enabled || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener?.("change", updatePreference);
    return () => mediaQuery.removeEventListener?.("change", updatePreference);
  }, [enabled]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, []);

  return visible;
}
