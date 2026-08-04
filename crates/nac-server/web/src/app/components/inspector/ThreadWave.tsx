import { Icon, IconName, Loader, LoaderSize, LoaderVariant } from "@/app/atoms";
import { ThreadLogTail } from "@/app/components/inspector/ThreadLogTail";
import { cn } from "@/app/lib/cn";
import type { ThreadState, TranscriptThread } from "@/app/lib/transcript";

interface ThreadBoxProps {
  thread: TranscriptThread;
  selected: boolean;
  onSelect: (name: string) => void;
}

const STATE_ORDER: Record<ThreadState, number> = {
  error: 0,
  running: 1,
  done: 2,
};

function StateIcon({ state }: { state: ThreadState }) {
  if (state === "running") {
    return <Loader size={LoaderSize.Small} variant={LoaderVariant.Neutral} />;
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
  return (
    <Icon
      iconName={IconName.CheckCircle}
      size={20}
      className="[&>path]:!fill-basic-primary"
    />
  );
}

/** One dispatched thread: name, live state and the newest line it produced. */
function ThreadBox({ thread, selected, onSelect }: ThreadBoxProps) {
  const running = thread.state === "running";
  // Before the first command there is nothing to tail, so the card keeps
  // showing what the thread was asked to do.
  const tail = thread.log.length
    ? thread.log
    : [{ key: "action", text: thread.action, isError: false }];

  return (
    // The ghost button paints its own transparent background, so the elevation
    // has to live on a wrapper underneath it.
    <div
      className={cn(
        "shrink-0 w-[292px] h-[84px] overflow-hidden rounded-[4px]",
        running ? "bg-elevation-level-2" : "bg-elevation-level-1",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex flex-col items-start w-full h-full text-left",
          selected ? "btn-ghost-highlighted" : "btn-ghost",
        )}
        aria-pressed={selected}
        onClick={() => onSelect(thread.name)}
      >
        <div className="flex items-center gap-2 shrink-0 p-2 w-full">
          <StateIcon state={thread.state} />
          <span
            className={cn(
              "flex-1 min-w-0 truncate label-small",
              running
                ? "text-shimmer-basic"
                : thread.state === "error"
                  ? "text-error-primary"
                  : "text-basic-primary",
            )}
          >
            {thread.name}
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
            <span className="line-clamp-2 text-micro text-basic-muted !my-0">
              {thread.summary}
            </span>
          </div>
        )}
      </button>
    </div>
  );
}

interface ThreadWaveProps {
  threads: TranscriptThread[];
  selected: string | null;
  onSelect: (name: string) => void;
}

/**
 * One batch of threads the orchestrator dispatched in parallel. The row scrolls
 * horizontally and the rail on the left carries the state of the whole wave.
 */
export function ThreadWave({ threads, selected, onSelect }: ThreadWaveProps) {
  const state = threads.reduce<ThreadState>(
    (worst, thread) =>
      STATE_ORDER[thread.state] < STATE_ORDER[worst] ? thread.state : worst,
    "done",
  );

  return (
    <div
      className={cn(
        "pl-4 py-3 my-8 w-full border-l-2 border-solid",
        "overflow-x-auto hide-scrollbar",
        // Fade the row out on the right so a wave reads as scrollable.
        "[mask-image:linear-gradient(to_right,black_calc(100%-48px),transparent)]",
        state === "error"
          ? "border-error-primary"
          : state === "running"
            ? "border-primary"
            : "border-tertiary",
      )}
    >
      <div className="flex items-start gap-1 pr-12 w-fit">
        {threads.map((thread) => (
          <ThreadBox
            key={thread.callId}
            thread={thread}
            selected={selected === thread.name}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
