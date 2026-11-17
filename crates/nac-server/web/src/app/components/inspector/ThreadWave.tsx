import { useId } from "react";

import { Icon, IconName } from "@/app/atoms";
import StatusDot from "@/app/atoms/status-dot";
import { ThreadLogTail } from "@/app/components/inspector/ThreadLogTail";
import { openOptionsFor } from "@/app/features/insights/transcript/openOptions";
import {
  INSIGHTS_DETAIL_ID,
  type InsightsOpenOptions,
} from "@/app/features/insights/useInsightsNavigation";
import { cn } from "@/app/lib/cn";
import type { SessionStatus } from "@/app/lib/sessionStatus";
import type { ThreadState, TranscriptThread } from "@/app/lib/transcript";

export type SelectThread = (
  name: string,
  episodeKey: string,
  options?: InsightsOpenOptions,
) => void;

interface ThreadRowProps {
  thread: TranscriptThread;
  selected: boolean;
  /** Without it the row only shows the thread. */
  onSelect?: SelectThread;
}

/** The state glyph in words; an error reads "failed", as on the thread's Insights row. */
const STATE_NAME = {
  error: "failed",
  running: "running",
  pending: "pending",
  cancelled: "cancelled",
  done: "done",
} satisfies Record<ThreadState, string>;

/** Each thread state on the one status ladder the app draws. */
const STATE_DOT = {
  error: "failed",
  running: "working",
  pending: "waiting",
  cancelled: "idle",
  done: "done",
} satisfies Record<ThreadState, SessionStatus>;

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-border-focus-outline)]";

/**
 * One dispatched thread as a quiet row: its status dot, its name and weight,
 * and one line of state — the newest command while it runs, what it reported
 * once it is done. Opens the thread's detail in Insights.
 */
function ThreadRow({ thread, selected, onSelect }: ThreadRowProps) {
  const bodyId = useId();
  const running = thread.state === "running";
  const pending = thread.state === "pending";
  const cancelled = thread.state === "cancelled";
  // Before the first command there is nothing to tail, so the row keeps
  // showing what the thread was asked to do.
  const tail = thread.log.length
    ? thread.log
    : [
        {
          key: "action",
          text: thread.action,
          bare: thread.action,
          mark: null,
          name: null,
          body: thread.action,
          isError: false,
        },
      ];
  const content = (
    <>
      <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
        <StatusDot status={STATE_DOT[thread.state]} size="md" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "min-w-0 truncate type-label",
              pending
                ? "text-basic-muted"
                : thread.state === "error"
                  ? "text-error-primary"
                  : "text-basic-primary",
            )}
          >
            {thread.name}
          </span>
          {thread.weight ? (
            <span className="shrink-0 rounded-pill bg-[var(--f-wash-2)] px-1.5 type-tag text-basic-tertiary">
              {thread.weight}
            </span>
          ) : null}
        </span>
        <span id={bodyId} className="block min-w-0">
          {running || cancelled ? (
            <ThreadLogTail lines={tail} className="h-4" />
          ) : (
            <span className="block truncate type-meta text-basic-tertiary">
              {pending ? "Waiting to start" : thread.summary}
            </span>
          )}
        </span>
      </span>
      {onSelect ? (
        <Icon
          iconName={IconName.Right}
          size={14}
          aria-hidden
          className="shrink-0 !text-fill-basic-muted opacity-0 transition-opacity duration-150 group-hover/thread:opacity-100 group-focus-visible/thread:opacity-100 [@media(hover:none)]:opacity-100"
        />
      ) : null}
    </>
  );
  const row = "flex w-full min-w-0 items-center gap-3 px-3.5 py-2 text-left max-md:min-h-11";

  return onSelect ? (
    <button
      type="button"
      className={cn(
        "group/thread",
        row,
        FOCUS_RING,
        "transition-colors duration-150 ease-out hover:bg-[var(--f-wash-1)]",
        selected && "bg-[var(--f-wash-2)]",
      )}
      aria-label={[thread.name, thread.weight, STATE_NAME[thread.state]].filter(Boolean).join(", ")}
      aria-describedby={bodyId}
      aria-pressed={selected}
      aria-controls={INSIGHTS_DETAIL_ID}
      onClick={(event) => onSelect(thread.name, thread.key, openOptionsFor(event))}
    >
      {content}
    </button>
  ) : (
    <div className={row}>{content}</div>
  );
}

interface ThreadWaveProps {
  /** Topological levels from one assistant dispatch batch (DAG waves). */
  rows: TranscriptThread[][];
  /** Episode key of the row the panels are pointing at, if it is one of these. */
  selected: string | null;
  /** Without it the rows only show their threads. */
  onSelect?: SelectThread;
}

/**
 * One orchestrator dispatch batch as a small quiet card. Threads that run
 * concurrently share a level; a level that waits on the one before it follows
 * under a hairline marked "Then".
 */
export function ThreadWave({ rows, selected, onSelect }: ThreadWaveProps) {
  return (
    <div className="flex w-full max-w-[560px] min-w-0 flex-col overflow-hidden rounded-card border border-tertiary bg-elevation-level-1">
      {rows.map((threads, index) => (
        <div
          key={threads.map((thread) => thread.key).join("|") || `row-${index}`}
          className={cn("flex min-w-0 flex-col py-1", index > 0 && "border-t border-muted")}
        >
          {index > 0 ? <span className="px-3.5 pt-1 type-tag text-basic-muted">Then</span> : null}
          {threads.map((thread) => (
            <ThreadRow
              key={thread.key}
              thread={thread}
              selected={selected === thread.key}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
