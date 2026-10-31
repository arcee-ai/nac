import type {
  ExecutionHistoryEntry,
  ExecutionStatus,
  InputControlStatus,
} from "../../../../packages/nac-client/src/index";
import { historyOutcome } from "./historyModel";

/** What the detail's header names and its hint explains. */
export interface TerminalHeading {
  title: string;
  /** The design's `Agent` tag, as `agentTagged` decides it. */
  agent: boolean;
  /** The hint's title: who runs the execution. */
  about: string;
  /** The hint's description, spoken in full after `about`. */
  facts: string;
}

function kind(source: ExecutionStatus): string {
  if (source.origin === "human") return "Shell";
  if (source.origin === "human_command") return "! command";
  return source.representation === "pty" ? "PTY" : "Command";
}

function originLabel(source: ExecutionStatus): string {
  if (source.origin === "human") return "Human shell";
  if (source.origin === "human_command") return "Human ! command";
  return "Agent execution";
}

/** A row's name. The position keeps two terminals of one kind apart. */
export function terminalTitle(source: ExecutionStatus, index: number): string {
  return `${kind(source)} ${index + 1}`;
}

/** Spoken after a row's name, which draws no state of its own. */
export function terminalState(source: ExecutionStatus): string {
  if (source.process_state === "cleanup_pending") return "cleanup pending";
  return source.alive ? "running" : "settled";
}

/**
 * A history entry passes its recorded outcome, which already reports the
 * process state, so it leads in the state's place; history is never writable.
 */
function executionFacts(source: ExecutionStatus, outcome?: string): string {
  const state = `${source.process_state.replaceAll("_", " ")}${source.exit_code == null ? "" : ` (${source.exit_code})`}`;
  const facts = outcome
    ? [outcome, source.backend, source.cwd]
    : [source.backend, source.cwd, state];
  facts.push(source.output_complete ? "collection complete" : "collecting output");
  if (
    outcome !== undefined ||
    source.representation === "log" ||
    (source.origin === "agent" && !source.retained)
  )
    facts.push("Read-only");
  return facts.join(" · ");
}

/** The design's `Agent` tag: the agent runs the execution, or holds a human shell's input. */
export function agentTagged(
  source: ExecutionStatus,
  controller?: InputControlStatus["controller"],
): boolean {
  return source.origin === "agent" || controller === "agent";
}

export function executionHeading(
  source: ExecutionStatus,
  title: string,
  controller?: InputControlStatus["controller"],
): TerminalHeading {
  return {
    title,
    agent: agentTagged(source, controller),
    about: originLabel(source),
    facts: executionFacts(source),
  };
}

function startedAt(entry: ExecutionHistoryEntry): string | null {
  const time = new Date(Number(entry.started_at_epoch_ms));
  return Number.isNaN(time.getTime())
    ? null
    : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** A recent entry's name: a command reads as itself, anything else by when it started. */
export function historyTitle(entry: ExecutionHistoryEntry): string {
  if (entry.command) return `! ${entry.command.command}`;
  if (!entry.execution) return "Unavailable execution";
  const time = startedAt(entry);
  return time ? `${kind(entry.execution)} · ${time}` : kind(entry.execution);
}

export function historyHeading(entry: ExecutionHistoryEntry): TerminalHeading {
  const title = historyTitle(entry);
  const outcome = historyOutcome(entry);
  const source = entry.execution;
  if (!source)
    return {
      title,
      agent: false,
      about: entry.command ? "Human ! command" : "Unavailable execution",
      facts: outcome,
    };
  return {
    title,
    agent: source.origin === "agent",
    about: originLabel(source),
    facts: executionFacts(source, outcome),
  };
}
