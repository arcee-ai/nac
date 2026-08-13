import { Icon, IconName, Loader, LoaderSize, LoaderVariant } from "@/app/atoms";
import { ThreadLogTail } from "@/app/components/inspector/ThreadLogTail";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import type { ThreadState, TranscriptThread } from "@/app/lib/transcript";

interface ThreadBoxProps {
  thread: TranscriptThread;
  selected: boolean;
  onSelect: (name: string, episodeKey: string) => void;
}

const STATE_ORDER: Record<ThreadState, number> = {
  error: 0,
  running: 1,
  pending: 2,
  cancelled: 3,
  done: 4,
};

function StateIcon({ state }: { state: ThreadState }) {
  if (state === "running") {
    return <Loader size={LoaderSize.Small} variant={LoaderVariant.Neutral} />;
  }
  if (state === "pending") {
    return (
      <Icon
        iconName={IconName.Timelaps}
        size={20}
        className="[&>path]:!fill-basic-muted"
      />
    );
  }
  if (state === "error") {
    return (
      <Icon
        iconName={IconName.Danger}
        size={20}
        // Beat `.btn-ghost .icon path { fill: … }` from atoms.css.
        className="[&>path]:!fill-error-primary"
      />
    );
  }
  if (state === "cancelled") {
    return (
      <Icon
        iconName={IconName.Close}
        size={20}
        className="[&>path]:!fill-basic-muted"
      />
    );
  }
  return (
    <Icon
      iconName={IconName.CheckCircle}
      size={20}
      className="[&>path]:!fill-basic-primary"
    />
  );
}

function worstState(threads: TranscriptThread[]): ThreadState {
  return threads.reduce<ThreadState>(
    (worst, thread) =>
      STATE_ORDER[thread.state] < STATE_ORDER[worst] ? thread.state : worst,
    "done",
  );
}

/** One dispatched thread: name, live state and the newest line it produced. */
function ThreadBox({ thread, selected, onSelect }: ThreadBoxProps) {
  const isMobile = useIsMobile();
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

  return (
    // The ghost button paints its own transparent background, so the elevation
    // has to live on a wrapper underneath it.
    <div
      className={cn(
        "shrink-0 h-[84px] max-w-full overflow-hidden rounded-[4px]",
        isMobile ? "w-[172px]" : "w-[220px]",
        running || pending ? "bg-elevation-level-2" : "bg-elevation-level-1",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex flex-col items-start w-full h-full text-left",
          selected ? "btn-ghost-highlighted" : "btn-ghost",
        )}
        aria-pressed={selected}
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
          <ThreadLogTail
            lines={tail}
            className="flex-1 min-h-0 w-full px-2 pb-2"
          />
        ) : (
          // Chrome blockifies `-webkit-box` flex items, so the clamped text
          // needs a plain wrapper to stay clamped.
          <div className="w-full px-2 pt-2">
            <span className="line-clamp-2 text-micro text-basic-muted !my-0 !text-[11px]">
              {pending ? "Pending..." : thread.summary}
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
 * One topological DAG level: threads that can run concurrently. The tiles wrap
 * within this level while the rail on the left carries its aggregate state.
 */
function WaveRow({ threads, selected, onSelect }: WaveRowProps) {
  const state = worstState(threads);

  return (
    <div
      className={cn(
        "pl-4 py-3 w-full min-w-0 border-l-2 border-solid",
        state === "error"
          ? "border-error-primary"
          : state === "running"
            ? "border-primary"
            : "border-tertiary",
      )}
    >
      <div className="flex flex-wrap items-start gap-1 w-full min-w-0">
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
