import { useCallback, useEffect, useRef, useState } from "react";

/** How long the caller keeps showing the "copied" acknowledgement. */
const ACK_MS = 2000;

/**
 * The Clipboard API is unavailable outside a secure context, which includes
 * reaching nac over plain http on a LAN address, so fall back to a throwaway
 * textarea there.
 */
function legacyCopy(text: string): boolean {
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
  }
}

export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const acknowledge = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), ACK_MS);
  }, []);

  const copy = useCallback(
    (content: string) => {
      if (!content) return;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(content)
          .then(acknowledge)
          .catch(() => {
            if (legacyCopy(content)) acknowledge();
          });
        return;
      }
      if (legacyCopy(content)) acknowledge();
    },
    [acknowledge],
  );

  return { copied, copy };
}
