import { TerminalTabButton, TerminalTabButtonSize } from "@/app/atoms";
import { PanelListNote } from "@/app/components/inspector/PanelMessages";
import { cn } from "@/app/lib/cn";
import type {
  ExecutionHistoryEntry,
  ExecutionHistoryResponse,
} from "../../../../packages/nac-client/src/types";
import { ExecutionDetail } from "./TerminalDetail";
import { NoticeAction, TerminalFrame, TerminalNotice } from "./TerminalChrome";
import { historyOutcome, historyOutputCopy, readOnlyHistorySource } from "./historyModel";
import { historyHeading, historyTitle } from "./terminalLabels";

/**
 * The list's Recent section: bounded history, one row per entry, each opening
 * read-only. Opening observes retained output and sends nothing to a process.
 */
export function RecentExecutions({
  history,
  pending,
  failed,
  openId,
  size,
  onOpen,
  onRefresh,
}: {
  history: ExecutionHistoryResponse["history"] | undefined;
  pending: boolean;
  failed: boolean;
  openId: string | null;
  size: TerminalTabButtonSize;
  onOpen: (entry: ExecutionHistoryEntry) => void;
  onRefresh: () => void;
}) {
  const entries = history?.entries ?? [];
  const large = size === TerminalTabButtonSize.Large;
  return (
    <section aria-label="Recent terminal activity" className="flex flex-col [&>*]:shrink-0">
      <h3
        className={cn(
          "truncate text-basic-muted",
          large ? "px-2 pt-6 pb-2 text-micro" : "px-1 pt-4 pb-1 text-[11px] leading-[14px]",
        )}
      >
        Recent
      </h3>
      <div className="flex flex-col gap-1 [&>*]:shrink-0">
        {pending ? <PanelListNote>Loading recent activity…</PanelListNote> : null}
        {failed ? (
          <TerminalNotice
            action={<NoticeAction onClick={onRefresh}>Refresh recent activity</NoticeAction>}
          >
            Recent activity unavailable.
          </TerminalNotice>
        ) : null}
        {!pending && !failed && entries.length === 0 ? (
          <PanelListNote>No recent activity is available.</PanelListNote>
        ) : null}
        {entries.map((entry) => {
          const title = historyTitle(entry);
          return (
            <TerminalTabButton
              key={entry.id}
              label={title}
              title={title}
              agent={entry.execution?.origin === "agent"}
              description={historyOutcome(entry)}
              size={size}
              active={entry.id === openId}
              onClick={() => onOpen(entry)}
            />
          );
        })}
        {history?.older_entries_omitted ? (
          <PanelListNote>Older entries are omitted from this recent view.</PanelListNote>
        ) : null}
      </div>
    </section>
  );
}

/**
 * An opened entry. Retained output replays through the same observer as a live
 * terminal, read-only; anything else shows what history recorded about it.
 */
export function HistoryDetail({
  sessionId,
  entry,
  menuSlot,
}: {
  sessionId: string;
  entry: ExecutionHistoryEntry;
  menuSlot: HTMLElement | null;
}) {
  const heading = historyHeading(entry);
  const source = readOnlyHistorySource(entry);
  if (source)
    return (
      <ExecutionDetail
        sessionId={sessionId}
        source={source}
        heading={heading}
        menuSlot={menuSlot}
        historical
        notice={entry.output.availability === "tail_gap" ? historyOutputCopy(entry) : undefined}
      />
    );
  const execution = entry.execution;
  return (
    <TerminalFrame
      heading={heading}
      menuSlot={menuSlot}
      notices={[
        <TerminalNotice key="output" info>
          {historyOutputCopy(entry)}{" "}
          {execution
            ? `Process: ${execution.process_state.replaceAll("_", " ")}. ${
                execution.output_complete
                  ? "Output collection ended."
                  : "Output collection pending."
              }`
            : "Current process status is unavailable. This entry has no restored live handle."}
        </TerminalNotice>,
        execution?.output_error ? (
          <TerminalNotice key="collection" live="status">
            Output collection error: {execution.output_error}
          </TerminalNotice>
        ) : null,
      ]}
    >
      {(top) => (
        <article
          aria-label="Recorded terminal activity"
          className={cn(
            "flex flex-col flex-1 min-h-0 gap-4 overflow-auto px-4 pb-4 font-[family-name:IBMPlexMono] text-sm font-medium [&>*]:shrink-0",
            top,
          )}
        >
          {entry.command ? (
            <>
              <pre
                aria-label="Canonical command preview"
                className="whitespace-pre-wrap break-words text-basic-tertiary"
              >
                {entry.command.command}
              </pre>
              {entry.command.stdout ? (
                <pre
                  aria-label="Recorded stdout"
                  className="whitespace-pre-wrap break-words text-basic-primary"
                >
                  {entry.command.stdout}
                </pre>
              ) : null}
              {entry.command.stderr ? (
                <pre
                  aria-label="Recorded stderr"
                  className="whitespace-pre-wrap break-words text-error-primary"
                >
                  {entry.command.stderr}
                </pre>
              ) : null}
              {entry.command.diagnostic ? (
                <p className="text-basic-muted">{entry.command.diagnostic}</p>
              ) : null}
            </>
          ) : null}
          <p className="text-basic-muted">{historyOutcome(entry)}</p>
        </article>
      )}
    </TerminalFrame>
  );
}
