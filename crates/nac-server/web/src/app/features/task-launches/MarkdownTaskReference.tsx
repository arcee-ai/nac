import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { routes } from "@/app/lib/routes";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useSessions } from "@/app/services/queries/session";
import { useFreshSessionInventory } from "@/app/services/queries/sessionInventory";
import type { ManagedSessionSummary } from "@/app/types/api";

function available(entries: ManagedSessionSummary[] | undefined, id: string): boolean {
  return !!entries?.some(
    ({ summary, lineage }) =>
      summary.session_id === id && summary.behavior === "direct" && lineage == null,
  );
}

/** Passive inventory confirms identity; activation rechecks before routing. */
export function MarkdownTaskReference({ id, children }: { id: string; children: ReactNode }) {
  const inventory = useSessions(0);
  const runtime = useNativeRuntime();
  const navigate = useNavigate();
  const location = useLocation();
  const generation = useRef(0);
  const binding = useMemo(
    () => ({ runtime, path: location.pathname, id }),
    [runtime, location.pathname, id],
  );
  const freshInventory = useFreshSessionInventory(binding);
  const pending = useRef<object | null>(null);
  const focusBinding = useRef<object | null>(null);
  const statusHadFocus = useRef(false);
  const retryHadFocus = useRef(false);
  const focusTransferred = useRef(false);
  const statusRef = useRef<HTMLSpanElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [checkingBinding, setCheckingBinding] = useState<object | null>(null);
  const [unavailable, setUnavailable] = useState<{ binding: object; dataUpdatedAt: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
      if (pending.current === binding) pending.current = null;
      if (focusBinding.current === binding) focusBinding.current = null;
      retryHadFocus.current = false;
    };
  }, [binding]);
  const checking = checkingBinding === binding;
  // A failed activation must not trust stale cached data. A later successful
  // inventory update (or an explicit retry) can make the same binding usable again.
  const failed =
    unavailable?.binding === binding &&
    (inventory.isError || inventory.dataUpdatedAt <= unavailable.dataUpdatedAt);
  const known = !inventory.isError && available(inventory.data, id) && !failed;
  useLayoutEffect(() => {
    // A passive inventory refresh can replace the focused retry with a link.
    // Preserve focus only if the user has not already moved it elsewhere.
    if (known && !checking && retryHadFocus.current) {
      retryHadFocus.current = false;
      linkRef.current?.focus();
    }
    if (focusBinding.current !== binding) return;
    if (checking) {
      if (!focusTransferred.current) {
        focusTransferred.current = true;
        statusRef.current?.focus();
      }
      return;
    }
    if (inventory.isPending) return;
    // Do not reclaim focus if the user moved elsewhere while the request ran.
    if (statusHadFocus.current) {
      if (known) linkRef.current?.focus();
      else retryRef.current?.focus();
    }
    statusHadFocus.current = false;
    focusBinding.current = null;
  }, [binding, checking, inventory.isPending, known]);
  const activate = (open: boolean, focused: boolean) => {
    if (pending.current === binding) return;
    if (focused) {
      retryHadFocus.current = false;
      focusBinding.current = binding;
      focusTransferred.current = false;
    }
    pending.current = binding;
    const current = generation.current;
    setCheckingBinding(binding);
    void (async () => {
      try {
        // A shared QueryObserver refetch may resolve with reverted cached data on
        // cancellation. This independent passive request must itself succeed.
        const entries = await freshInventory();
        if (generation.current !== current) return;
        if (!available(entries, id)) {
          setUnavailable({ binding, dataUpdatedAt: Date.now() });
          return;
        }
        setUnavailable(null);
        if (open) navigate(routes.session(id));
      } catch {
        if (generation.current !== current) return;
        setUnavailable({ binding, dataUpdatedAt: inventory.dataUpdatedAt });
      } finally {
        if (generation.current === current) {
          pending.current = null;
          setCheckingBinding(null);
        }
      }
    })();
  };
  const status =
    checking || inventory.isPending
      ? "Checking task availability"
      : !known
        ? "Task unavailable"
        : "";
  const announcement =
    checking || inventory.isPending
      ? "Checking whether the task is available."
      : known
        ? "The task is available."
        : "The task is unavailable.";
  return (
    <span>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
      {!known || checking ? (
        <>
          <span
            ref={statusRef}
            onFocus={() => {
              statusHadFocus.current = true;
            }}
            onBlur={() => {
              statusHadFocus.current = false;
            }}
            tabIndex={-1}
            aria-disabled="true"
            title={status}
            className="rounded-sm focus:outline-2 focus:outline-[var(--color-border-focus-outline)]"
          >
            {children} ({status})
          </span>
          {!checking && !inventory.isPending ? (
            <>
              {" "}
              <button
                ref={retryRef}
                onFocus={() => {
                  retryHadFocus.current = true;
                }}
                onBlur={() => {
                  retryHadFocus.current = false;
                }}
                type="button"
                className="inline-flex min-h-7 items-center rounded-sm px-1 text-accent-primary underline focus-visible:outline-2 focus-visible:outline-[var(--color-border-focus-outline)] max-md:min-h-11"
                onClick={(event) => activate(false, document.activeElement === event.currentTarget)}
              >
                Check again
              </button>
            </>
          ) : null}
        </>
      ) : (
        <a
          ref={linkRef}
          role="link"
          tabIndex={0}
          onClick={(event) => activate(true, document.activeElement === event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              activate(true, document.activeElement === event.currentTarget);
            }
          }}
        >
          {children}
        </a>
      )}
    </span>
  );
}
