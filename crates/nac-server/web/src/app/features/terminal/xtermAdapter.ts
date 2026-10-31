import type { Terminal } from "@xterm/xterm";
import type { UserTerminalRenderer } from "../../../../packages/nac-client/src/index";
import "@xterm/xterm/css/xterm.css";

// The design's Code-micro: IBM Plex Mono Medium, 12px on a 16px row.
const FONT_SIZE = 12;
const FONT_WEIGHT = 500;
const ROW_HEIGHT = 16;
const LINE_HEIGHT = 1;
const FONT = '"IBMPlexMono", Menlo, monospace';

/** xterm draws literal colours, so the tokens are resolved where it is mounted. */
function tokenTheme(element: HTMLElement) {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim() || undefined;
  const background = token("--color-bg-elevation-ground");
  const foreground = token("--color-text-basic-primary");
  return { background, foreground, cursor: foreground, cursorAccent: background };
}

/** Only public xterm APIs. Bytes are acknowledged after its parser callback. */
export async function createTerminalRenderer(element: HTMLElement) {
  const { Terminal } = await import("@xterm/xterm");
  const terminal = new Terminal({
    cols: 80,
    rows: 24,
    fontFamily: FONT,
    fontSize: FONT_SIZE,
    fontWeight: FONT_WEIGHT,
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
    theme: tokenTheme(element),
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

/**
 * Measure the configured font rather than depending on private renderer
 * internals. The grid fills the element's content box; its padding stays clear.
 */
function fitTerminal(terminal: Terminal, element: HTMLElement) {
  const style = getComputedStyle(element);
  const inset = (start: string, end: string) => (parseFloat(start) || 0) + (parseFloat(end) || 0);
  const width = element.clientWidth - inset(style.paddingLeft, style.paddingRight);
  const height = element.clientHeight - inset(style.paddingTop, style.paddingBottom);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context || width < 1 || height < 1) return null;
  context.font = `${FONT_WEIGHT} ${FONT_SIZE}px ${FONT}`;
  const metrics = context.measureText("W");
  if (metrics.width <= 0) return null;
  const row = rowMetrics(metrics);
  const restyled = row !== null && terminal.options.lineHeight !== row.lineHeight;
  if (restyled) terminal.options.lineHeight = row.lineHeight;
  const cols = Math.max(2, Math.min(500, Math.floor((width - 18) / metrics.width)));
  // Right after a restyle the rendered rows still have the previous height.
  const renderedRowHeight =
    terminal.element && !restyled ? terminal.element.clientHeight / terminal.rows : 0;
  const rowHeight =
    renderedRowHeight > 0 ? renderedRowHeight : (row?.height ?? FONT_SIZE * LINE_HEIGHT);
  const rows = Math.max(1, Math.min(300, Math.floor(height / rowHeight)));
  if (terminal.cols === cols && terminal.rows === rows) return null;
  terminal.resize(cols, rows);
  return { cols, rows };
}

/**
 * xterm rounds the font's measured height up to device pixels and floors that
 * times `lineHeight`, so the multiplier for the design's row depends on both:
 * browsers that report whole-pixel font metrics need a larger one than those
 * that don't.
 */
function rowMetrics(metrics: TextMetrics) {
  const dpr = window.devicePixelRatio || 1;
  const glyph = Math.ceil((metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) * dpr);
  const row = Math.round(ROW_HEIGHT * dpr);
  if (!(glyph > 0) || glyph > row) return null;
  return { lineHeight: (row + 0.5) / glyph, height: row / dpr };
}
