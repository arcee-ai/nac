import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { Icon, IconName, StatusDot } from "@/app/atoms";
import { compactAge } from "@/app/features/sidebar/relativeTime";
import type { SessionStatusIndex } from "@/app/features/sidebar/sessionStatuses";
import { useNow } from "@/app/hooks/useNow";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { cn } from "@/app/lib/cn";
import { formatClock, parseStoreTime } from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import { SESSION_STATUS_LABEL, needsYou } from "@/app/lib/sessionStatus";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

const CARD_LIMIT = 6;
const RECENT_LIMIT = 8;

export function SectionHeading({
  children,
  trailing,
}: {
  children: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 px-1">
      <h2 className="type-subheading text-basic-primary">{children}</h2>
      {trailing}
    </div>
  );
}

function useOpenSession() {
  const navigate = useNavigate();
  const { clearAttention } = useNativeRuntime().stores.attentionStore;
  return (id: string) => {
    clearAttention(id);
    navigate(routes.session(id));
  };
}

function projectName(projects: readonly ProjectRecord[], entry: ManagedSessionSummary) {
  const id = entry.summary.project_id;
  return projects.find((project) => project.project_id === id)?.name ?? "Unassigned";
}

/** A live card: a session that needs the user, or one that is working. */
function LiveCard({
  entry,
  projects,
  statuses,
  now,
  onOpen,
}: {
  entry: ManagedSessionSummary;
  projects: readonly ProjectRecord[];
  statuses: SessionStatusIndex;
  now: number;
  onOpen: (id: string) => void;
}) {
  const sessionTitle = useSessionTitle();
  const id = entry.summary.session_id;
  const status = statuses.rolled(id);
  const title = sessionTitle(entry.summary);
  const urgent = needsYou(status);
  const started = entry.active_run?.started_at_epoch_ms;
  const preview = entry.active_run?.prompt_preview?.trim();
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      aria-label={`${title}, ${SESSION_STATUS_LABEL[status]}`}
      className={cn(
        "group flex min-w-0 flex-col gap-2 rounded-card border p-4 text-left outline-none",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
        urgent
          ? "border-[var(--f-amber-line)] bg-[var(--f-amber-wash)] hover:bg-[var(--f-amber-wash-2)]"
          : "border-tertiary bg-elevation-level-1 hover:border-secondary",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={status} size="md" />
        <span className="type-strong min-w-0 flex-1 truncate text-basic-primary">{title}</span>
        <Icon
          iconName={IconName.ArrowRight}
          size={14}
          className="shrink-0 text-basic-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        />
      </div>
      <p
        className={cn(
          "type-meta min-w-0 truncate",
          urgent ? "text-[var(--f-amber-text)]" : "text-basic-tertiary",
          status === "working" && "focus-shimmer",
        )}
      >
        {urgent ? SESSION_STATUS_LABEL[status] : preview ? preview : SESSION_STATUS_LABEL[status]}
      </p>
      <p className="type-meta tabular flex min-w-0 items-center gap-1.5 text-basic-muted">
        <span className="truncate">{projectName(projects, entry)}</span>
        {started && status === "working" ? (
          <>
            <span aria-hidden>·</span>
            <span className="shrink-0">{formatClock(Math.max(0, now - started))}</span>
          </>
        ) : null}
      </p>
    </button>
  );
}

/**
 * Home's live groups — "Needs you" then "Running", each only when non-empty —
 * and the quiet "Recent" list.
 */
export function HomeActivity({
  sessions,
  projects,
  statuses,
}: {
  sessions: readonly ManagedSessionSummary[];
  projects: readonly ProjectRecord[];
  statuses: SessionStatusIndex;
}) {
  const sessionTitle = useSessionTitle();
  const open = useOpenSession();
  const groups = useMemo(() => {
    const needs: ManagedSessionSummary[] = [];
    const running: ManagedSessionSummary[] = [];
    const recent: ManagedSessionSummary[] = [];
    const sorted = [...sessions].sort(
      (a, b) => parseStoreTime(b.summary.updated_at) - parseStoreTime(a.summary.updated_at),
    );
    for (const entry of sorted) {
      const status = statuses.own(entry.summary.session_id);
      // Subagents surface here only when they need the user.
      if (needsYou(status)) needs.push(entry);
      else if (entry.lineage) continue;
      else if (status === "working") running.push(entry);
      else recent.push(entry);
    }
    return { needs, running, recent: recent.slice(0, RECENT_LIMIT) };
  }, [sessions, statuses]);
  const ticking = groups.running.length > 0;
  const now = useNow(ticking ? 1000 : 60_000);

  return (
    <>
      {groups.needs.length > 0 ? (
        <section aria-label="Needs you" className="flex flex-col gap-2">
          <SectionHeading>Needs you</SectionHeading>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-2">
            {groups.needs.slice(0, CARD_LIMIT).map((entry) => (
              <LiveCard
                key={entry.summary.session_id}
                entry={entry}
                projects={projects}
                statuses={statuses}
                now={now}
                onOpen={open}
              />
            ))}
          </div>
        </section>
      ) : null}
      {groups.running.length > 0 ? (
        <section aria-label="Running" className="flex flex-col gap-2">
          <SectionHeading>Running</SectionHeading>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-2">
            {groups.running.slice(0, CARD_LIMIT).map((entry) => (
              <LiveCard
                key={entry.summary.session_id}
                entry={entry}
                projects={projects}
                statuses={statuses}
                now={now}
                onOpen={open}
              />
            ))}
          </div>
        </section>
      ) : null}
      {groups.recent.length > 0 ? (
        <section aria-label="Recent" className="flex flex-col gap-1">
          <SectionHeading>Recent</SectionHeading>
          <ul className="flex flex-col">
            {groups.recent.map((entry) => {
              const id = entry.summary.session_id;
              const status = statuses.rolled(id);
              const title = sessionTitle(entry.summary);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => open(id)}
                    className={cn(
                      "flex h-10 w-full min-w-0 items-center gap-3 rounded-md px-3 text-left outline-none max-md:h-12",
                      "transition-colors duration-150 ease-out hover:bg-[var(--f-wash-1)]",
                      "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--f-focus)]",
                    )}
                  >
                    <span className="flex size-3 shrink-0 items-center justify-center">
                      <StatusDot status={status} />
                    </span>
                    <span className="type-body-chrome min-w-0 flex-1 truncate text-basic-primary">
                      {title}
                    </span>
                    <span className="type-meta hidden min-w-0 max-w-[40%] truncate text-basic-tertiary sm:block">
                      {projectName(projects, entry)}
                    </span>
                    <span className="type-meta tabular w-12 shrink-0 text-right text-basic-muted">
                      {compactAge(entry.summary.updated_at, now)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}
