import type { ExecutionHistoryEntry } from "../../../../packages/nac-client/src/types";

export function historySourceLabel(entry: ExecutionHistoryEntry): string {
  const execution = entry.execution;
  if (entry.command) return `Human command: ${entry.command.command.slice(0, 60)}`;
  if (!execution) return "Unavailable execution";
  if (execution.origin === "human") return "Human shell";
  return execution.representation === "pty" ? "Agent PTY" : "Agent command log";
}

export function historyOutcome(entry: ExecutionHistoryEntry): string {
  const command = entry.command;
  const execution = entry.execution;
  if (command) {
    const state = command.state.replaceAll("_", " ");
    return `${state}${command.exit_code == null ? "" : ` · exit ${command.exit_code}`}`;
  }
  if (!execution) return "Current process status unavailable";
  if (execution.process_state === "cleanup_pending") return "Cleanup pending";
  if (execution.process_state === "running") return "Running";
  const result = entry.outcome?.replaceAll("_", " ") ?? "Settled";
  return `${result}${execution.exit_code == null ? "" : ` · exit ${execution.exit_code}`}`;
}

export function historyOutputCopy(entry: ExecutionHistoryEntry): string {
  switch (entry.output.availability) {
    case "retained":
      return "Retained output available.";
    case "tail_gap":
      return `Earlier output was discarded. Retained bytes ${entry.output.retained_start}–${entry.output.retained_end}; the display resets before reading the tail.`;
    case "expired":
      return "Output expired. The recorded outcome remains available.";
    case "process_local_unavailable":
      return "Process-local output unavailable. It may have expired or been lost on server restart; no shell or log is restored.";
    case "not_recorded":
      return "No fuller output reference was recorded. This does not prove an unconfirmed command had no effects.";
  }
}

export function canReopenHistory(entry: ExecutionHistoryEntry): boolean {
  return (
    !!entry.execution &&
    (entry.output.availability === "retained" || entry.output.availability === "tail_gap")
  );
}

export function readOnlyHistorySource(entry: ExecutionHistoryEntry) {
  if (!canReopenHistory(entry) || !entry.execution) return null;
  // Retention is an owner fact, not a capability. The history view mode must
  // suppress lifetime/control actions without claiming those leases ended.
  return { ...entry.execution, input: false, resize: false, stop: false };
}
