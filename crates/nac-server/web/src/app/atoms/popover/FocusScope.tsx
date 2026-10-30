import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
const focusableItems = (scope: HTMLElement) =>
  Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (item) =>
      item.tabIndex >= 0 && !item.matches(":disabled") && !item.closest("[inert], [hidden]"),
  );

/** Opt-in keyboard ownership for actions portaled outside an enclosing dialog. */
export function PopoverFocusScope({
  open,
  label,
  onClose,
  children,
}: {
  open: boolean;
  label: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const activation = useRef<{ scope: HTMLElement; opener: Element | null } | null>(null);
  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const scope = host.current;
    if (!open || !scope) return;
    const opener = document.activeElement;
    activation.current = { scope, opener };
    (focusableItems(scope)[0] ?? scope).focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current?.();
      } else if (event.key === "Tab") {
        // Keep both native modal traps and xterm's keyboard input out of this event.
        event.preventDefault();
        event.stopPropagation();
        const enabled = focusableItems(scope);
        const index = enabled.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? (index <= 0 ? enabled.length : index) - 1
          : (index + 1) % enabled.length;
        (enabled[next] ?? scope).focus({ preventScroll: true });
      }
    };
    scope.addEventListener("keydown", onKey);
    return () => {
      scope.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    const scope = host.current;
    // Polling can remove or disable the focused control as ownership changes.
    // Preserve a deliberate focus destination outside the menu.
    if (
      open &&
      scope &&
      (document.activeElement === document.body ||
        (scope.contains(document.activeElement) && document.activeElement?.matches(":disabled")))
    ) {
      (focusableItems(scope)[0] ?? scope).focus({ preventScroll: true });
    }
  });

  useEffect(() => {
    if (!open || !activation.current) return;
    const { scope, opener } = activation.current;
    return () => {
      // Restore after React's commit focus restoration: a closing phone sheet
      // keeps its DOM during the exit animation. A new dialog may own focus.
      if (
        opener instanceof HTMLElement &&
        opener.isConnected &&
        (scope.contains(document.activeElement) || document.activeElement === document.body)
      ) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return (
    <div
      ref={host}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      inert={!open}
      aria-hidden={!open}
      className="outline-none"
    >
      {children}
    </div>
  );
}
