import type { UserTerminalRenderer } from "../../../../packages/nac-client/src/index";
const MAX_TEXT = 65_536;

/** Safe bounded text, without VT interpretation, clickable links or HTML. */
export function createLogRenderer(host: HTMLElement) {
  let decoder = new TextDecoder();
  let text = "";
  let disposed = false;
  const append = (value: string) => {
    let literal = "";
    for (const character of value) {
      const code = character.charCodeAt(0);
      literal +=
        (code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159)
          ? `\\x${code.toString(16).padStart(2, "0")}`
          : character;
    }
    text = (text + literal).slice(-MAX_TEXT);
    host.textContent = text;
    host.scrollTop = host.scrollHeight;
  };
  const check = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (disposed) throw new DOMException("Log renderer closed", "AbortError");
  };
  const renderer: UserTerminalRenderer = {
    write: async (bytes, signal) => {
      check(signal);
      append(decoder.decode(bytes, { stream: true }));
    },
    reset: async (_reason, signal) => {
      check(signal);
      decoder = new TextDecoder();
      text = "";
      host.textContent = "";
    },
  };
  return {
    renderer,
    finish: () => {
      if (!disposed) append(decoder.decode());
    },
    dispose: () => {
      disposed = true;
    },
  };
}
