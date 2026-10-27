import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

import { Button, ButtonSize, ButtonVariant, ShimmerLoader } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { STICK_TOLERANCE_PX, distanceFromBottom, scrollToBottomInstantly } from "@/app/lib/scroll";
import {
  groupThreadLog,
  threadIsThinking,
  type LogEntry,
  type StandaloneLine,
  type ThreadLogLine,
  type ToolCallEntry,
} from "@/app/lib/threadLog";

/**
 * One tool call and, when it has arrived, the result beneath it. Pending calls
 * shimmer so the eye lands on the command the thread is on right now.
 */
const ToolCallView = memo(function ToolCallView({
  entry,
  running,
}: {
  entry: ToolCallEntry;
  /** Whether the thread is still running — a call with no result in a
   * finished thread is history, not something in flight. */
  running: boolean;
}) {
  const pending = entry.status === "pending" && running;
  return (
    <div className="pt-1">
      <p
        className={cn(
          "code code-small whitespace-pre-wrap break-words",
          // Solid colours on child spans would override the fill the shimmer
          // needs, so a pending line stays one clipped gradient.
          pending ? "text-shimmer-basic" : "text-basic-tertiary",
        )}
      >
        {pending ? (
          <>
            {"▸ "}
            {`${entry.toolName}: `}
            {entry.keyArg}
          </>
        ) : (
          <>
            <span className="text-info-primary">{"▸ "}</span>
            <span className="text-basic-primary">{`${entry.toolName}: `}</span>
            {entry.keyArg}
          </>
        )}
      </p>
      {entry.resultPreview !== null ? (
        // Only the glyph carries the outcome. What a failing command printed is
        // the part worth reading, and a whole line of red reads as unreadable
        // rather than as urgent — a "File not found" is a plain fact about the
        // path in it.
        <p className="pl-4 pt-0.5 code code-small whitespace-pre-wrap break-words text-basic-tertiary">
          <span className={entry.isError ? "text-error-primary" : "text-success-primary"}>
            {`${entry.isError ? "✕" : "✓"} `}
          </span>
          {entry.resultPreview}
        </p>
      ) : null}
    </div>
  );
});

/**
 * A line the worker printed that is not a tool call — its plain log output.
 */
const StandaloneView = memo(function StandaloneView({ entry }: { entry: StandaloneLine }) {
  return (
    <p className="pt-1 code code-small whitespace-pre-wrap break-words text-basic-tertiary">
      {entry.mark ? (
        <span className={entry.isError ? "text-error-primary" : "text-success-primary"}>
          {`${entry.mark} `}
        </span>
      ) : null}
      {entry.name ? <span className="text-basic-primary">{`${entry.name}: `}</span> : null}
      {entry.body}
    </p>
  );
});

/**
 * Dispatches a grouped log entry to its view. Kept as a switch so the compiler
 * flags any new `LogEntry` kind that is not handled.
 */
const LogEntryView = memo(function LogEntryView({
  entry,
  running,
}: {
  entry: LogEntry;
  running: boolean;
}) {
  if (entry.kind === "tool_call") return <ToolCallView entry={entry} running={running} />;
  return <StandaloneView entry={entry} />;
});

/**
 * The log itself: the commands as they were issued, stuck to the bottom for as
 * long as the reader leaves it there.
 */
function LogScroller({
  scrollRef,
  stuckRef,
  entries,
  running,
  thinking,
  loading,
  className,
  historyControl,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Whether the reader is still at the bottom, so new lines may scroll. */
  stuckRef: RefObject<boolean>;
  entries: LogEntry[];
  running: boolean;
  /** Model is between tool calls — show a live shimmer line under the log. */
  thinking: boolean;
  loading: boolean;
  className?: string;
  historyControl?: ReactNode;
}) {
  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0 bg-elevation-ground",
        className,
      )}
      onScroll={() => {
        const element = scrollRef.current;
        if (element) {
          stuckRef.current = distanceFromBottom(element) <= STICK_TOLERANCE_PX;
        }
      }}
    >
      {historyControl}
      <div className="pb-[128px] md:pb-4">
        {entries.map((entry) => (
          <LogEntryView
            key={entry.kind === "tool_call" ? `call-${entry.callId}` : entry.key}
            entry={entry}
            running={running}
          />
        ))}
        {thinking ? (
          <p className="pt-1 code code-small">
            <span className="text-info-primary">{"▸ "}</span>
            <span className="text-shimmer-basic">Working…</span>
          </p>
        ) : null}
        {!entries.length && !thinking && (loading || running) ? (
          <div role="status" aria-label="Loading command log" className="pt-4">
            <ShimmerLoader rows={3} rowClassName="h-6" />
          </div>
        ) : null}
        {!entries.length && !running && !loading ? (
          <p className="pt-4 code code-small text-basic-muted">No commands recorded.</p>
        ) : null}
      </div>
    </div>
  );
}

/** Command log filling the detail pane. */
export function LogPane({
  lines,
  running,
  hasOlder,
  loadingOlder,
  loadingInitial,
  historyError,
  onRetry,
  onLoadOlder,
  className,
}: {
  lines: ThreadLogLine[];
  running: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadingInitial: boolean;
  historyError: string | null;
  onLoadOlder: () => Promise<void>;
  onRetry: () => Promise<void>;
  className?: string;
}) {
  const prependAnchor = useRef<{
    height: number;
    top: number;
    firstKey: string | null;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  const entries = useMemo(() => groupThreadLog(lines), [lines]);
  const thinking = useMemo(() => threadIsThinking(running, lines), [running, lines]);
  const firstEntryKey =
    entries[0]?.kind === "tool_call" ? `call-${entries[0].callId}` : (entries[0]?.key ?? null);

  useLayoutEffect(() => {
    const anchor = prependAnchor.current;
    const element = scrollRef.current;
    if (!anchor || !element || anchor.firstKey === firstEntryKey) return;
    element.scrollTop = anchor.top + (element.scrollHeight - anchor.height);
    prependAnchor.current = null;
  }, [firstEntryKey]);

  useEffect(() => {
    const anchor = prependAnchor.current;
    if (!loadingOlder && anchor?.firstKey === firstEntryKey) {
      prependAnchor.current = null;
    }
  }, [firstEntryKey, loadingOlder]);

  const loadOlder = () => {
    stuckRef.current = false;
    const element = scrollRef.current;
    if (element) {
      prependAnchor.current = {
        height: element.scrollHeight,
        top: element.scrollTop,
        firstKey: firstEntryKey,
      };
    }
    void onLoadOlder().catch(() => {
      prependAnchor.current = null;
    });
  };

  // Before paint, not after: a log is read from its foot, and a pane that put
  // its head on screen first — which is where a fresh scroll container starts,
  // and where opening another chat lands — would show the wrong end of the
  // thread for a frame and then snap away from it.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !stuckRef.current) return;
    scrollToBottomInstantly(element);
  }, [entries.length, thinking]);

  return (
    <LogScroller
      scrollRef={scrollRef}
      stuckRef={stuckRef}
      entries={entries}
      running={running}
      thinking={thinking}
      loading={loadingInitial}
      className={className}
      historyControl={
        hasOlder || historyError ? (
          <div className="flex items-center gap-2 pb-3">
            {hasOlder ? (
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Secondary}
                disabled={loadingOlder}
                onClick={loadOlder}
              >
                {loadingOlder ? "Loading…" : "Load older commands"}
              </Button>
            ) : null}
            {historyError ? (
              <>
                <span className="text-micro text-error-primary">{historyError}</span>
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Ghost}
                  onClick={() => {
                    if (hasOlder) loadOlder();
                    else void onRetry();
                  }}
                >
                  Try again
                </Button>
              </>
            ) : null}
          </div>
        ) : null
      }
    />
  );
}
