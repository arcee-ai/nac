import type { Terminal } from "@xterm/xterm";

/** Public renderer/browser events supply intent; parsed output never does. */
export function observeHumanTerminalInput(
  terminal: Terminal,
  send: (bytes: Uint8Array) => void,
): () => void {
  const textarea = terminal.textarea;
  if (!textarea) return () => {};
  let closed = false;
  let paste = false;
  let composition: { prefix: string; text: string } | undefined;
  let compositionTimer: ReturnType<typeof setTimeout> | undefined;
  const focused = () => !closed && textarea.ownerDocument.activeElement === textarea;
  const host = terminal.element ?? textarea;
  const pointerTypes = new Set(["mousedown", "mouseup", "mousemove", "wheel"]);
  const pointerDispatch = () => {
    // The browser's public current-event slot binds encoding to the actual
    // native dispatch, without a timer window that could admit parser replies.
    const event = textarea.ownerDocument.defaultView?.event;
    return (
      !!event?.isTrusted &&
      event.currentTarget !== null &&
      pointerTypes.has(event.type) &&
      !!event.target &&
      typeof (event.target as Node).nodeType === "number" &&
      host.contains(event.target as Node)
    );
  };
  const text = (data: string) => {
    if (data && focused()) send(new TextEncoder().encode(data));
  };
  const finishComposition = () => {
    if (compositionTimer !== undefined) clearTimeout(compositionTimer);
    compositionTimer = undefined;
    const intent = composition;
    composition = undefined;
    if (!intent || !focused()) return;
    // Only a snapshot from a trusted native input event supplies text. Neither
    // a late DOM mutation nor a synthetic end event can add input authority.
    text(intent.text);
  };
  const key = terminal.onKey(({ key, domEvent }) => {
    if (!domEvent.isTrusted || !focused()) return;
    finishComposition();
    text(key);
  });
  const data = terminal.onData((value) => {
    // Only the public paste call or a trusted pointer dispatch may use xterm's
    // encoded data. Device-query/focus/resize replies have no such invocation.
    if (paste || pointerDispatch()) text(value);
  });
  const binary = terminal.onBinary((value) => {
    if (pointerDispatch() && focused())
      send(Uint8Array.from(value, (character) => character.charCodeAt(0)));
  });
  const onPaste = (event: ClipboardEvent) => {
    if (!event.isTrusted || !focused() || !event.clipboardData) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finishComposition();
    paste = true;
    try {
      // Xterm remains the sole owner of newline/bracketed-paste encoding.
      terminal.paste(event.clipboardData.getData("text/plain"));
    } finally {
      paste = false;
    }
  };
  const onCompositionStart = (event: CompositionEvent) => {
    if (!event.isTrusted || !focused()) return;
    finishComposition();
    composition = { prefix: textarea.value, text: "" };
  };
  const onCompositionInput = (event: InputEvent) => {
    if (!event.isTrusted || !focused() || !composition) return;
    const value = textarea.value;
    composition.text = value.startsWith(composition.prefix)
      ? value.slice(composition.prefix.length)
      : "";
  };
  const onCompositionEnd = () => {
    const intent = composition;
    if (!intent) return;
    // Some native browser/CDP end signals are synthetic. They can only settle
    // already captured trusted edits. The next task admits any final native
    // input event; an interrupting key or detach consumes/fences this intent.
    if (compositionTimer !== undefined) clearTimeout(compositionTimer);
    compositionTimer = setTimeout(() => {
      compositionTimer = undefined;
      if (!closed && composition === intent) finishComposition();
    }, 0);
  };
  host.addEventListener("paste", onPaste, true);
  textarea.addEventListener("compositionstart", onCompositionStart, true);
  textarea.addEventListener("compositionend", onCompositionEnd, true);
  textarea.addEventListener("input", onCompositionInput, true);
  return () => {
    if (closed) return;
    closed = true;
    if (compositionTimer !== undefined) clearTimeout(compositionTimer);
    compositionTimer = undefined;
    composition = undefined;
    key.dispose();
    data.dispose();
    binary.dispose();
    host.removeEventListener("paste", onPaste, true);
    textarea.removeEventListener("compositionstart", onCompositionStart, true);
    textarea.removeEventListener("compositionend", onCompositionEnd, true);
    textarea.removeEventListener("input", onCompositionInput, true);
  };
}
