import type { Terminal } from "@xterm/xterm";
import type { TerminalLinkMode } from "./terminalLinkMode";
import type { UserTerminalRenderer } from "../../../../packages/nac-client/src/index";
import "@xterm/xterm/css/xterm.css";
import "./xtermLinks.css";

// The design's Code-micro: IBM Plex Mono Medium, 12px on a 16px row.
const FONT_SIZE = 12;
const FONT_WEIGHT = 500;
const ROW_HEIGHT = 16;
const LINE_HEIGHT = 1;
const FONT = '"Geist Mono Variable", Menlo, monospace';

/** xterm draws literal colours, so the tokens are resolved where it is mounted. */
function tokenTheme(element: HTMLElement) {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim() || undefined;
  const background = token("--color-bg-elevation-ground");
  const foreground = token("--color-text-basic-primary");
  return { background, foreground, cursor: foreground, cursorAccent: background };
}

/** Only public xterm APIs. Bytes are acknowledged after its parser callback. */
export async function createTerminalRenderer(
  element: HTMLElement,
  options: { readonly linkMode?: TerminalLinkMode } = {},
) {
  const { Terminal } = await import("@xterm/xterm");
  let links: ReturnType<typeof terminalLinkAffordance> | undefined;
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
    linkHandler:
      options.linkMode === "native-visible-anchor"
        ? {
            allowNonHttpProtocols: false,
            // A cell activation reveals the real link; only its browser default
            // click/Enter performs navigation. No popup or synthetic click here.
            activate: (event, uri) => {
              if (event.isTrusted) links?.show(uri, true);
            },
            hover: (event, uri) => {
              if (event.isTrusted) links?.show(uri, false);
            },
            leave: () => links?.leave(),
          }
        : {
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
  if (options.linkMode === "native-visible-anchor") links = terminalLinkAffordance(terminal);
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
        links?.hide(); // Output may replace the link under the current buffer range.
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
      links?.hide();
      terminal.reset();
    },
  };
  return {
    terminal,
    renderer,
    fit: () => {
      const size = fitTerminal(terminal, element);
      if (size) links?.hide();
      return size;
    },
    dispose: () => {
      disposed = true;
      links?.dispose();
      clipboard.dispose();
      terminal.dispose();
    },
  };
}

/** One bounded real link in xterm's documented embedder hover surface. */
function terminalLinkAffordance(terminal: Terminal) {
  const host = terminal.element;
  const document = host?.ownerDocument;
  let closed = false;
  let current = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hovered = false;
  let blurred = false;
  let previousWasInput = false;
  const card = document?.createElement("div");
  const anchor = document?.createElement("a");
  const close = document?.createElement("button");
  const cancelTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const focused = () => !!card?.contains(document?.activeElement ?? null);
  const hide = () => {
    cancelTimer();
    current = "";
    hovered = false;
    card?.remove();
    anchor?.removeAttribute("href");
  };
  const leave = () => {
    cancelTimer();
    if (closed || !current || !card?.isConnected) return;
    // Display grace only: it conveys no navigation or input authority.
    timer = setTimeout(() => {
      timer = undefined;
      if (!hovered && !focused()) hide();
    }, 250);
  };
  if (card && anchor && close) {
    card.className = "xterm-hover nac-terminal-link";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", "Terminal link");
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close terminal link");
    card.append(anchor, close);
    // Keep mouse reporting/selection in the underlying terminal untouched.
    // No default prevention: a real anchor retains click/modifier/Enter behavior.
    for (const name of ["mousedown", "mouseup", "mousemove", "wheel"])
      card.addEventListener(name, (event) => event.stopPropagation());
    card.addEventListener("mouseenter", () => {
      hovered = true;
      cancelTimer();
    });
    card.addEventListener("mouseleave", () => {
      hovered = false;
      leave();
    });
    card.addEventListener("focusin", cancelTimer);
    card.addEventListener("focusout", leave);
    anchor.addEventListener("click", (event) => {
      if (!event.isTrusted || closed || !host?.isConnected || !current || anchor.href !== current)
        event.preventDefault();
      event.stopPropagation();
    });
    close.addEventListener("click", (event) => {
      event.stopPropagation(); // Do not trigger the terminal frame's click-to-focus owner.
      const restore =
        event.isTrusted && focused() && previousWasInput && !terminal.options.disableStdin;
      hide();
      if (restore && !closed && host?.isConnected) terminal.textarea?.focus();
    });
  }
  const visibility = () => {
    if (document?.visibilityState !== "visible") hide();
  };
  const blur = () => {
    blurred = true;
    hide();
  };
  const focus = () => {
    blurred = false;
  };
  // xterm activates on mouseup; the subsequent cell click must not let the
  // surrounding frame steal the focus just handed to the visible anchor.
  const cellClick = (event: MouseEvent) => {
    if (!closed && event.isTrusted && current && document?.activeElement === anchor)
      event.stopPropagation();
  };
  host?.addEventListener("click", cellClick);
  document?.addEventListener("visibilitychange", visibility);
  document?.defaultView?.addEventListener("blur", blur);
  document?.defaultView?.addEventListener("focus", focus);
  const scroll = terminal.onScroll(hide);
  const resize = terminal.onResize(hide);
  const selection = terminal.onSelectionChange(hide);
  return {
    hide,
    leave,
    show: (uri: string, focus: boolean) => {
      if (
        closed ||
        blurred ||
        document?.visibilityState !== "visible" ||
        !host?.isConnected ||
        !card ||
        !anchor ||
        terminal.hasSelection()
      )
        return;
      const url = terminalLinkURL(uri);
      // Hover cannot retarget a link already being read/used from the keyboard.
      if (!focus && focused() && url !== current) return;
      if (!url) {
        hide();
        return;
      }
      cancelTimer();
      if (!card.isConnected || (focus && !focused()))
        previousWasInput = document?.activeElement === terminal.textarea;
      current = url;
      anchor.href = url;
      const origin = new URL(url).origin;
      // Terminal URLs may carry credentials in path/query/fragment. Only the
      // destination origin is shown; the full target lives solely in href/state.
      anchor.textContent = "Open " + origin + "/…";
      anchor.setAttribute(
        "aria-label",
        "Open terminal link in browser at " + origin + "; destination details hidden",
      );
      if (!card.isConnected) host.append(card);
      if (focus) anchor.focus(); // Reveal only; never .click(), location or window.open.
    },
    dispose: () => {
      if (closed) return;
      closed = true;
      hide();
      scroll.dispose();
      resize.dispose();
      selection.dispose();
      document?.removeEventListener("visibilitychange", visibility);
      document?.defaultView?.removeEventListener("blur", blur);
      document?.defaultView?.removeEventListener("focus", focus);
      host?.removeEventListener("click", cellClick);
    },
  };
}

/** The visible canonical label and actual href always name the same target. */
function terminalLinkURL(uri: string): string | null {
  if (uri.length > 8192 || new TextEncoder().encode(uri).length > 8192) return null;
  try {
    const url = new URL(uri);
    return ["http:", "https:"].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password &&
      url.origin.length <= 320 &&
      new TextEncoder().encode(url.href).length <= 8192
      ? url.href
      : null;
  } catch {
    return null;
  }
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
