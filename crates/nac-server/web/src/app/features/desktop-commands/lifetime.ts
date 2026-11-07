import type { DesktopCommandPort } from "./adapter";

/** Native-only retirement. Closing the root releases setup and terminal Effects
 * synchronously before the page acknowledges disposal. No intent is retained. */
export function installDesktopLifetime(
  port: DesktopCommandPort | undefined,
  runtime: { close(): void },
  unmount: () => void,
  events: Pick<Window, "addEventListener" | "removeEventListener">,
): () => void {
  if (typeof port?.connectLifetime !== "function") return () => {};
  let closed = false;
  let disconnect = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      runtime.close();
    } finally {
      try {
        unmount();
      } finally {
        disconnect();
        events.removeEventListener("pagehide", close);
      }
    }
  };
  disconnect = port.connectLifetime(close);
  events.addEventListener("pagehide", close, { once: true });
  return close;
}

/** Preserve the real transport/admission/readback owners. Only a failed GET
 * reports connection loss: a dropped mutation must first reach its existing
 * uncertainty/readback handling, never trigger a second dispatch here. */
export function desktopReadFetch(
  port: DesktopCommandPort | undefined,
  fetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  if (typeof port?.reportConnectionLost !== "function") return fetch;
  return async (input, init) => {
    try {
      return await fetch(input, init);
    } catch (error) {
      const request =
        typeof Request !== "undefined" && input instanceof Request ? input : undefined;
      const method = init?.method ?? request?.method ?? "GET";
      const signal = init?.signal ?? request?.signal;
      if (method.toUpperCase() === "GET" && !signal?.aborted) {
        try {
          port.reportConnectionLost?.();
        } catch {
          /* Transport error stays authoritative. */
        }
      }
      throw error;
    }
  };
}
