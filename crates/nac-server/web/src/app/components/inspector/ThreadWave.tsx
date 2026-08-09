import { Icon, IconName, Loader, LoaderSize, LoaderVariant } from "@/app/atoms";
import { ThreadLogTail } from "@/app/components/inspector/ThreadLogTail";
import { cn } from "@/app/lib/cn";
import type { ThreadState, TranscriptThread } from "@/app/lib/transcript";

interface ThreadBoxProps {
  thread: TranscriptThread;
  selected: boolean;
  onSelect: (name: string, episodeKey: string) => void;
}

const STATE_ORDER: Record<ThreadState, number> = {
  failed: 0,
  cancelled: 1,
  cancelling: 2,
  running: 3,
  accepted: 4,
  dependency_pending: 4,
  completed: 5,
};

const STATE_LABEL: Record<ThreadState, string> = {
  accepted: "Accepted",
  dependency_pending: "Pending",
  running: "Running",
  cancelling: "Cancelling",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function StateIcon({ state }: { state: ThreadState }) {
  if (state === "running" || state === "cancelling") {
    return <Loader size={LoaderSize.Small} variant={LoaderVariant.Neutral} />;
  }
  if (state === "accepted" || state === "dependency_pending") {
    return <Icon iconName={IconName.Timelaps} size={20} className="[&>path]:!fill-basic-muted" />;
  }
  if (state === "failed" || state === "cancelled") {
    return <Icon iconName={IconName.Danger} size={20} className={state === "failed" ? "[&>path]:!fill-error-primary" : "[&>path]:!fill-basic-muted"} />;
  }
  return <Icon iconName={IconName.CheckCircle} size={20} className="[&>path]:!fill-basic-primary" />;
}

function worstState(threads: TranscriptThread[]): ThreadState {
  return threads.reduce<ThreadState>(
    (worst, thread) => STATE_ORDER[thread.state] < STATE_ORDER[worst] ? thread.state : worst,
    "completed",
  );
}

/** One dispatched thread: name, live state and the newest line it produced. */
function ThreadBox({ thread, selected, onSelect }: ThreadBoxProps) {
  const running = thread.state === "running";
  const cancelling = thread.state === "cancelling";
  const pending = thread.state === "accepted" || thread.state === "dependency_pending";
  const stateLabel = STATE_LABEL[thread.state];
  const deliveryLabel = thread.delivery === "available" ? "Result available" : thread.delivery === "delivered" ? "Result delivered" : null;
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

  return (
    // The ghost button paints its own transparent background, so the elevation
    // has to live on a wrapper underneath it.
    <div
      className={cn(
        "shrink-0 w-[220px] h-[84px] overflow-hidden rounded-[4px]",
        running || pending || cancelling ? "bg-elevation-level-2" : "bg-elevation-level-1",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex flex-col items-start w-full h-full text-left",
          selected ? "btn-ghost-highlighted" : "btn-ghost",
        )}
        aria-pressed={selected}
        aria-label={`${thread.name}: ${stateLabel}${deliveryLabel ? `, ${deliveryLabel}` : ""}`}
        onClick={() => onSelect(thread.name, thread.key)}
      >
        <div className="flex items-center gap-2 shrink-0 p-2 w-full">
          <StateIcon state={thread.state} />
          <span
            className={cn(
              "flex-1 min-w-0 truncate label-small",
              running
                ? "text-shimmer-basic"
                : pending
                  ? "text-basic-muted"
                  : thread.state === "failed"
                    ? "text-error-primary"
                    : "text-basic-primary",
            )}
          >
            {thread.name}
          </span>
          <span className="label-micro text-basic-muted shrink-0">
            {stateLabel}
          </span>
        </div>
        {running ? (
          <ThreadLogTail
            lines={tail}
            className="flex-1 min-h-0 w-full px-2 pb-2"
          />
        ) : (
          // Chrome blockifies `-webkit-box` flex items, so the clamped text
          // needs a plain wrapper to stay clamped.
          <div className="w-full px-2 pt-2">
            <span className="line-clamp-2 text-micro text-basic-muted !my-0 !text-[11px]">
              {deliveryLabel ?? (pending ? stateLabel : cancelling ? "Cancelling…" : thread.summary)}
            </span>
          </div>
        )}
      </button>
    </div>
  );
}

interface WaveRowProps {
  threads: TranscriptThread[];
  selected: string | null;
  onSelect: (name: string, episodeKey: string) => void;
}

/**
 * One topological DAG level: threads that can run concurrently. The row scrolls
 * horizontally and the rail on the left carries the state of this level.
 */
function WaveRow({ threads, selected, onSelect }: WaveRowProps) {
  const state = worstState(threads);

  return (
    <div
      className={cn(
        "pl-4 py-3 w-full border-l-2 border-solid",
        "overflow-x-auto hide-scrollbar",
        // Fade the row out on the right so a wave reads as scrollable.
        "[mask-image:linear-gradient(to_right,black_calc(100%-48px),transparent)]",
        state === "failed"
          ? "border-error-primary"
          : state === "running" || state === "cancelling"
            ? "border-primary"
            : "border-tertiary",
      )}
    >
      <div className="flex items-start gap-1 pr-12 w-fit">
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
  );
}

interface ThreadWaveProps {
  /** Topological levels from one assistant dispatch batch (DAG waves). */
  rows: TranscriptThread[][];
  /** Episode key of the card the panels are pointing at, if it is one of these. */
  selected: string | null;
  onSelect: (name: string, episodeKey: string) => void;
}

/**
 * One orchestrator dispatch batch, possibly split into stacked DAG levels.
 * Independent threads share a row; dependents wait in the next row as pending.
 */
export function ThreadWave({ rows, selected, onSelect }: ThreadWaveProps) {
  return (
    <div className="my-8 w-full flex flex-col items-start">
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
