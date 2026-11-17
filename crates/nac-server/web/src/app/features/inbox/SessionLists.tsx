import { useRef, type KeyboardEvent } from "react";

import { SessionTree } from "@/app/features/sidebar/SessionTree";
import { cn } from "@/app/lib/cn";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { SidebarView } from "@/app/store/sidebarLayoutStore";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

import { InboxList } from "./InboxList";
import { useInbox } from "./inboxContext";

const VIEWS: readonly { id: SidebarView; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "sessions", label: "Sessions" },
];

/**
 * Inbox · Sessions: one small switch over the sidebar list. The choice is
 * remembered; the Inbox tab carries the number of sessions that need you.
 */
export function SessionListSwitch({ touch = false }: { touch?: boolean }) {
  const { useView, setView } = useNativeRuntime().stores.sidebarLayoutStore;
  const view = useView();
  const { model } = useInbox();
  const tabs = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = view === "inbox" ? "sessions" : "inbox";
    setView(next);
    tabs.current?.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)?.focus();
  };

  return (
    <div
      ref={tabs}
      role="tablist"
      aria-label="Sidebar list"
      onKeyDown={onKeyDown}
      className="flex items-center gap-0.5 rounded-pill bg-[var(--f-wash-1)] p-0.5"
    >
      {VIEWS.map((option) => {
        const selected = view === option.id;
        const badge = option.id === "inbox" ? model.badge : 0;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            data-view={option.id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            aria-label={badge ? `${option.label}, ${badge} need you` : option.label}
            onClick={() => setView(option.id)}
            className={cn(
              "type-label flex flex-1 items-center justify-center gap-1.5 rounded-pill px-3 outline-none",
              touch ? "min-h-11" : "h-7",
              "transition-colors duration-150 ease-out motion-reduce:transition-none",
              "focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
              selected
                ? "bg-elevation-level-1 text-basic-primary shadow-md"
                : "text-basic-tertiary hover:text-basic-primary",
            )}
          >
            {option.label}
            {badge ? (
              <span
                aria-hidden
                className="type-tag tabular inline-flex min-w-4 items-center justify-center rounded-pill bg-[var(--f-amber-wash-2)] px-1 text-[var(--f-amber-text)]"
              >
                {badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The selected list under the switch. */
export function SessionListBody({
  projects,
  sessions,
  activeSessionId,
  touch = false,
  onNavigate,
}: {
  projects: readonly ProjectRecord[];
  sessions: readonly ManagedSessionSummary[];
  activeSessionId: string | null;
  touch?: boolean;
  onNavigate?: () => void;
}) {
  const { useView } = useNativeRuntime().stores.sidebarLayoutStore;
  const view = useView();
  return (
    <div role="tabpanel" aria-label={view === "inbox" ? "Inbox" : "Sessions"}>
      {view === "inbox" ? (
        <InboxList touch={touch} onOpened={onNavigate} />
      ) : (
        <SessionTree
          projects={projects}
          sessions={sessions}
          activeSessionId={activeSessionId}
          touch={touch}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}
