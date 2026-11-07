import { useCallback, useEffect, useRef, useState } from "react";

/** How long the caller keeps showing the "copied" acknowledgement. */
const ACK_MS = 2000;

/**
 * The Clipboard API is unavailable outside a secure context, which includes
 * reaching nac over plain http on a LAN address, so fall back to a throwaway
 * textarea there.
 */
function legacyCopy(text: string): boolean {
  // The throwaway field takes focus to be selected; hand it back afterwards so
  // a keyboard user stays on the control that asked for the copy.
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.top = "-9999px";
  document.body.appendChild(area);
  try {
    area.focus();
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
    previous?.focus();
  }
}

export type CopyOutcome = "idle" | "copied" | "failed";

export function useCopyToClipboard() {
  const [outcome, setOutcome] = useState<CopyOutcome>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const acknowledge = useCallback((next: Exclude<CopyOutcome, "idle">) => {
    if (timer.current) clearTimeout(timer.current);
    setOutcome(next);
    // A failure stays until the next attempt: the user still has to copy by hand.
    timer.current = next === "copied" ? setTimeout(() => setOutcome("idle"), ACK_MS) : null;
  }, []);

  const copy = useCallback(
    (content: string) => {
      if (!content) return;
      const fallback = () => acknowledge(legacyCopy(content) ? "copied" : "failed");
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(content)
          .then(() => acknowledge("copied"))
          .catch(fallback);
        return;
      }
      fallback();
    },
    [acknowledge],
  );

  return { copied: outcome === "copied", outcome, copy };
}
