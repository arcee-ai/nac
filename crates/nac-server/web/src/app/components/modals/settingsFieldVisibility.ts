/** Keep focused Settings controls inside their own Modal body, including after resize. */
export function observeSettingsFieldVisibility(content: HTMLDivElement) {
  const body = content.parentElement;
  const view = content.ownerDocument.defaultView;
  if (!body || !view) return;
  let disposed = false;
  let pending: number | undefined;

  const reveal = () => {
    pending = undefined;
    if (disposed || !content.isConnected || content.parentElement !== body) return;
    const root = content.getRootNode();
    const active = "activeElement" in root ? root.activeElement : null;
    // The presentation may belong to another document/realm or a shadow root.
    if (!(active instanceof view.HTMLElement) || !content.contains(active)) return;
    const bounds = body.getBoundingClientRect();
    const control = active.getBoundingClientRect();
    const style = view.getComputedStyle(body);
    const top = bounds.top + body.clientTop + parseFloat(style.paddingTop);
    const bottom =
      bounds.top + body.clientTop + body.clientHeight - parseFloat(style.paddingBottom);
    if (
      ![top, bottom, control.top, control.bottom, control.height].every(Number.isFinite) ||
      control.height <= 0 ||
      control.height > bottom - top
    )
      return;
    if (control.top < top) body.scrollTop -= top - control.top;
    else if (control.bottom > bottom) body.scrollTop += control.bottom - bottom;
  };

  const schedule = () => {
    if (disposed || pending !== undefined) return;
    // A focus-event microtask can precede the native default action. Use one
    // coalesced task after native focus/caret scrolling, never a polling loop.
    pending = view.setTimeout(reveal, 0);
  };
  content.addEventListener("focusin", schedule);
  content.addEventListener("input", schedule);
  const observer = new view.ResizeObserver(schedule);
  observer.observe(body);
  observer.observe(content);
  schedule();
  return () => {
    disposed = true;
    if (pending !== undefined) view.clearTimeout(pending);
    content.removeEventListener("focusin", schedule);
    content.removeEventListener("input", schedule);
    observer.disconnect();
  };
}
