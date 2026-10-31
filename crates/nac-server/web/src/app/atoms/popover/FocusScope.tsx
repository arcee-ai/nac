import { useLayoutEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
const focusableItems = (scope: HTMLElement) =>
  Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (item) =>
      item.tabIndex >= 0 && !item.matches(":disabled") && !item.closest("[inert], [hidden]"),
  );

/** Initial focus and Tab navigation; the presentation layer owns dismissal and focus return. */
export function PopoverFocusScope({
  open,
  label,
  children,
}: {
  open: boolean;
  label: string;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scope = host.current;
    if (!open || !scope) return;
    (focusableItems(scope)[0] ?? scope).focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
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
