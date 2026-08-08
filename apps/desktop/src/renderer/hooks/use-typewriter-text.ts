import { useEffect, useState } from "react";

export function useTypewriterText(text: string, enabled: boolean, delayMs = 12): string {
  const [visible, setVisible] = useState(enabled ? "" : text);

  useEffect(() => {
    if (!enabled) {
      setVisible(text);
      return undefined;
    }
    if (!text) {
      setVisible("");
      return undefined;
    }

    setVisible("");
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setVisible(text.slice(0, index));
      if (index >= text.length) {
        clearInterval(timer);
      }
    }, delayMs);

    return () => clearInterval(timer);
  }, [delayMs, enabled, text]);

  return visible;
}
