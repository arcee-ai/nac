import { useState } from "react";
import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import type {
  ExecutionHistoryEntry,
  ExecutionStatus,
} from "../../../../packages/nac-client/src/types";
import { useExecutionHistory } from "./historyQueries";
import {
  canReopenHistory,
  historyOutcome,
  historyOutputCopy,
  historySourceLabel,
  readOnlyHistorySource,
} from "./historyModel";

interface RecentExecutionHistoryProps {
  sessionId: string;
  /** Reuse the existing native observer/renderer owner with this read-only source. */
  onReopen: (source: ExecutionStatus, entry: ExecutionHistoryEntry) => void;
}

export function RecentExecutionHistory({ sessionId, onReopen }: RecentExecutionHistoryProps) {
  const query = useExecutionHistory(sessionId);
  const [selected, setSelected] = useState("");
  const entries = query.data?.history.entries ?? [];
  const entry = entries.find((item) => item.id === selected);
  return (
    <section aria-label="Recent terminal activity" className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`recent-executions-${sessionId}`}>Recent activity</label>
        <select
          id={`recent-executions-${sessionId}`}
          value={entry?.id ?? ""}
          onChange={(event) => setSelected(event.target.value)}
          className="min-w-0 max-w-full rounded-md border border-muted bg-elevation-level-2 px-2 py-1"
        >
          <option value="">Choose recent activity</option>
          {entries.map((item, index) => (
            <option key={item.id} value={item.id}>
              {index + 1}. {historySourceLabel(item)} · {historyOutcome(item)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-basic-secondary">
        Up to 32 recent entries. Older metadata can expire. Reopening observes output and sends no
        input.
      </p>
      {query.isPending ? <p role="status">Loading recent activity…</p> : null}
      {query.isError ? (
        <p role="alert">
          Recent activity unavailable.{" "}
          <Button type="button" size={ButtonSize.Small} onClick={() => void query.refetch()}>
            Refresh recent activity
          </Button>
        </p>
      ) : null}
      {!query.isPending && !query.isError && entries.length === 0 ? (
        <p>No recent activity is available.</p>
      ) : null}
      {selected && !entry ? (
        <p role="status">Selected activity is no longer in bounded history.</p>
      ) : null}
      {query.data?.history.older_entries_omitted ? (
        <p>Older entries are omitted from this recent view.</p>
      ) : null}
      {entry ? (
        <article
          aria-label="Recorded terminal activity"
          className="flex flex-col gap-1 max-h-56 overflow-auto"
        >
          <p>
            {historySourceLabel(entry)} · {historyOutcome(entry)}
          </p>
          <p>{historyOutputCopy(entry)}</p>
          {entry.execution ? (
            <p>
              Process: {entry.execution.process_state.replaceAll("_", " ")}.{" "}
              {entry.execution.output_complete
                ? "Output collection ended."
                : "Output collection pending."}
            </p>
          ) : (
            <p>Current process status is unavailable. This entry has no restored live handle.</p>
          )}
          {entry.execution?.output_error ? (
            <p role="status">Output collection error: {entry.execution.output_error}</p>
          ) : null}
          {entry.command ? (
            <div aria-label="Canonical command preview">
              <pre className="whitespace-pre-wrap break-words">{entry.command.command}</pre>
              {entry.command.stdout ? (
                <pre aria-label="Recorded stdout" className="whitespace-pre-wrap break-words">
                  {entry.command.stdout}
                </pre>
              ) : null}
              {entry.command.stderr ? (
                <pre aria-label="Recorded stderr" className="whitespace-pre-wrap break-words">
                  {entry.command.stderr}
                </pre>
              ) : null}
              {entry.command.diagnostic ? <p>{entry.command.diagnostic}</p> : null}
            </div>
          ) : null}
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Secondary}
            disabled={!canReopenHistory(entry)}
            onClick={() => {
              const source = readOnlyHistorySource(entry);
              if (source) onReopen(source, entry);
            }}
          >
            Reopen retained output
          </Button>
        </article>
      ) : null}
    </section>
  );
}
