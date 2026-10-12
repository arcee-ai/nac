import type { Terminal } from "@xterm/xterm";
import type { UserTerminalRenderer } from "../../../../packages/nac-client/src/index";
import "@xterm/xterm/css/xterm.css";

const FONT_SIZE = 14;
const LINE_HEIGHT = 1.2;
const FONT = '"IBMPlexMono", Menlo, monospace';

/** Only public xterm APIs. Bytes are acknowledged after its parser callback. */
export async function createTerminalRenderer(element: HTMLElement) {
  const { Terminal } = await import("@xterm/xterm");
  const terminal = new Terminal({
    cols: 80,
    rows: 24,
    fontFamily: FONT,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    scrollback: 2000,
    screenReaderMode: true,
    disableStdin: true,
    linkHandler: {
      activate: (event, uri) => {
        if (!event.isTrusted) return;
        try {
          const url = new URL(uri);
          if (url.protocol === "https:" || url.protocol === "http:")
            window.open(url.href, "_blank", "noopener,noreferrer");
        } catch {
          /* Invalid terminal links are inert. */
        }
      },
    },
    theme: { background: "#151719", foreground: "#eeeeee" },
  });
  terminal.open(element);
  // Untrusted command output must not write the user's clipboard through OSC 52.
  const clipboard = terminal.parser.registerOscHandler(52, () => true);
  let disposed = false;
  const renderer: UserTerminalRenderer = {
    write: (bytes, signal) =>
      new Promise<void>((resolve, reject) => {
        if (disposed || signal.aborted) {
          reject(signal.reason ?? new DOMException("Renderer closed", "AbortError"));
          return;
        }
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        terminal.write(bytes, () => {
          signal.removeEventListener("abort", abort);
          if (disposed || signal.aborted) reject(signal.reason);
          else resolve();
        });
      }),
    reset: async (_reason, signal) => {
      signal.throwIfAborted();
      if (disposed) throw new DOMException("Renderer closed", "AbortError");
      terminal.reset();
    },
  };
  return {
    terminal,
    renderer,
    fit: () => fitTerminal(terminal, element),
    dispose: () => {
      disposed = true;
      clipboard.dispose();
      terminal.dispose();
    },
  };
}

/** Measure the configured font rather than depending on private renderer internals. */
function fitTerminal(terminal: Terminal, element: HTMLElement) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context || element.clientWidth < 1 || element.clientHeight < 1) return null;
  context.font = `${FONT_SIZE}px ${FONT}`;
  const width = context.measureText("W").width;
  if (width <= 0) return null;
  const cols = Math.max(2, Math.min(500, Math.floor((element.clientWidth - 18) / width)));
  const rows = Math.max(
    1,
    Math.min(300, Math.floor(element.clientHeight / (FONT_SIZE * LINE_HEIGHT))),
  );
  if (terminal.cols === cols && terminal.rows === rows) return null;
  terminal.resize(cols, rows);
  return { cols, rows };
}
