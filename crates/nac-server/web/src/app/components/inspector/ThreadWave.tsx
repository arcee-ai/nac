import { useId } from "react";

import { Icon, IconName, Loader, LoaderSize, LoaderVariant } from "@/app/atoms";
import { ThreadLogTail } from "@/app/components/inspector/ThreadLogTail";
import { openOptionsFor } from "@/app/features/insights/transcript/openOptions";
import {
  INSIGHTS_DETAIL_ID,
  type InsightsOpenOptions,
} from "@/app/features/insights/useInsightsNavigation";
import { cn } from "@/app/lib/cn";
import type { ThreadState, TranscriptThread } from "@/app/lib/transcript";

export type SelectThread = (
  name: string,
  episodeKey: string,
  options?: InsightsOpenOptions,
) => void;

interface ThreadBoxProps {
  thread: TranscriptThread;
  selected: boolean;
  /** Without it the card only shows the thread. */
  onSelect?: SelectThread;
}

const STATE_ORDER = {
  error: 0,
  running: 1,
  pending: 2,
  cancelled: 3,
  done: 4,
} satisfies Record<ThreadState, number>;

/** The state icon in words; an error reads "failed", as on the thread's Insights row. */
const STATE_NAME = {
  error: "failed",
  running: "running",
  pending: "pending",
  cancelled: "cancelled",
  done: "done",
} satisfies Record<ThreadState, string>;

const ICON_SIZE = "size-4 xl:size-5";

/** Two lines of summary fill the body exactly. */
const SUMMARY_BODY = "h-11 w-full p-1.5 xl:h-12 xl:p-2";

/** The log runs past the top edge, so its oldest line shows only in part. */
const LOG_BODY = "h-11 w-full px-1.5 pb-1.5 xl:h-12 xl:px-2 xl:pb-2";

function StateIcon({ state }: { state: ThreadState }) {
  if (state === "running") {
    return (
      <Loader
        size={LoaderSize.Small}
        variant={LoaderVariant.Neutral}
        className="shrink-0 [&_svg]:size-4 xl:[&_svg]:size-5"
      />
    );
  }
  if (state === "pending") {
    return (
      <Icon
        iconName={IconName.Timelaps}
        className={cn(ICON_SIZE, "shrink-0 [&>path]:!fill-basic-muted")}
      />
    );
  }
  if (state === "error") {
    return (
      <Icon
        iconName={IconName.Danger}
        // Beat `.btn-ghost .icon path { fill: … }` from atoms.css.
        className={cn(ICON_SIZE, "shrink-0 [&>path]:!fill-error-primary")}
      />
    );
  }
  if (state === "cancelled") {
    return (
      <Icon
        iconName={IconName.Close}
        className={cn(ICON_SIZE, "shrink-0 [&>path]:!fill-basic-muted")}
      />
    );
  }
  return (
    <Icon
      iconName={IconName.CheckCircle}
      className={cn(ICON_SIZE, "shrink-0 [&>path]:!fill-basic-primary")}
    />
  );
}

function worstState(threads: TranscriptThread[]): ThreadState {
  return threads.reduce<ThreadState>(
    (worst, thread) => (STATE_ORDER[thread.state] < STATE_ORDER[worst] ? thread.state : worst),
    "done",
  );
}

/** One dispatched thread: name, live state and the newest lines it produced. */
function ThreadBox({ thread, selected, onSelect }: ThreadBoxProps) {
  const bodyId = useId();
  const running = thread.state === "running";
  const pending = thread.state === "pending";
  const cancelled = thread.state === "cancelled";
  // Before the first command there is nothing to tail, so the card keeps
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
      <div className="flex w-full shrink-0 items-center gap-1 px-1.5 py-2 xl:gap-2.5 xl:p-2">
        <StateIcon state={thread.state} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs/4 font-medium xl:text-sm/5",
            running
              ? "text-shimmer-basic"
              : pending
                ? "text-basic-muted"
                : thread.state === "error"
                  ? "text-error-primary"
                  : "text-basic-primary",
          )}
        >
          {thread.name}
        </span>
        {thread.weight && (
          <span className="shrink-0 rounded-[3px] bg-elevation-level-3 px-1 text-[9px] uppercase tracking-wide text-basic-muted">
            {thread.weight}
          </span>
        )}
      </div>
      {running || cancelled ? (
        <div id={bodyId} className="w-full">
          <ThreadLogTail lines={tail} className={LOG_BODY} />
        </div>
      ) : (
        // Chrome blockifies `-webkit-box` flex items, so the clamped text
        // needs a plain wrapper to stay clamped.
        <div id={bodyId} className={SUMMARY_BODY}>
          <span className="line-clamp-2 text-micro text-basic-muted">
            {pending ? "Pending..." : thread.summary}
          </span>
        </div>
      )}
    </>
  );
  const surface = "flex h-full w-full flex-col items-start text-left";

  return (
    // The ghost button paints its own transparent background, so the elevation
    // has to live on a wrapper underneath it.
    <div
      className={cn(
        "w-[180px] shrink-0 overflow-hidden rounded-[4px] shadow-convex xl:w-[220px]",
        running ? "bg-elevation-level-2" : "bg-elevation-level-1",
      )}
    >
      {onSelect ? (
        <button
          type="button"
          className={cn(
            surface,
            "-outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2",
            selected ? "btn-ghost-highlighted" : "btn-ghost",
          )}
          aria-label={[thread.name, thread.weight, STATE_NAME[thread.state]]
            .filter(Boolean)
            .join(", ")}
          aria-describedby={bodyId}
          aria-pressed={selected}
          aria-controls={INSIGHTS_DETAIL_ID}
          onClick={(event) => onSelect(thread.name, thread.key, openOptionsFor(event))}
        >
          {content}
        </button>
      ) : (
        <div className={surface}>{content}</div>
      )}
    </div>
  );
}

interface WaveRowProps {
  threads: TranscriptThread[];
  selected: string | null;
  onSelect?: SelectThread;
}

/**
 * One topological DAG level: threads that can run concurrently. The cards
 * scroll sideways within this level while the rail on the left carries its
 * aggregate state.
 */
function WaveRow({ threads, selected, onSelect }: WaveRowProps) {
  const state = worstState(threads);

  return (
    <div
      className={cn(
        "w-full min-w-0 border-l-2 border-solid py-2 xl:py-3",
        state === "error"
          ? "border-error-primary"
          : state === "running"
            ? "border-primary"
            : "border-muted",
      )}
    >
      {/* The cards cut off under the fade are what tells there is more. */}
      <div className="scrollbar-none overflow-x-auto overflow-y-hidden overscroll-x-contain [mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)]">
        <div className="flex w-max items-start gap-1 pr-8 pl-3 xl:pl-4">
          {threads.map((thread) => (
            <ThreadBox
              key={thread.key}
              thread={thread}
              selected={selected === thread.key}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ThreadWaveProps {
  /** Topological levels from one assistant dispatch batch (DAG waves). */
  rows: TranscriptThread[][];
  /** Episode key of the card the panels are pointing at, if it is one of these. */
  selected: string | null;
  /** Without it the cards only show their threads. */
  onSelect?: SelectThread;
}

/**
 * One orchestrator dispatch batch, possibly split into stacked DAG levels.
 * Independent threads share a row; dependents wait in the next row as pending.
 */
export function ThreadWave({ rows, selected, onSelect }: ThreadWaveProps) {
  return (
    <div className="flex w-full flex-col items-start">
      {rows.map((threads, index) => (
        <WaveRow
          key={threads.map((thread) => thread.key).join("|") || `row-${index}`}
          threads={threads}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
