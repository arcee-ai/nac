import { describe, expect, it } from "vitest";
import type { ExecutionHistoryEntry } from "../../../../packages/nac-client/src/types";
import {
  canReopenHistory,
  historyOutcome,
  historyOutputCopy,
  readOnlyHistorySource,
} from "./historyModel";

export const record: ExecutionHistoryEntry = {
  id: "command-request",
  started_at_epoch_ms: "1000",
  outcome: "completed",
  execution: {
    id: "execution-current-instance",
    origin: "human_command",
    representation: "log",
    cwd: "/workspace",
    backend: "local",
    request_id: "request",
    alive: false,
    process_state: "settled",
    exit_code: 7,
    output_complete: true,
    input: false,
    resize: false,
    stop: false,
    retained: false,
    cols: 0,
    rows: 0,
  },
  command: {
    request_id: "request",
    operation_id: "operation",
    command: "printf known; exit 7",
    timeout_ms: 30000,
    state: "completed",
    accepted_at_epoch_ms: 1000,
    finished_at_epoch_ms: 1010,
    exit_code: 7,
    stdout: "known",
    stderr: "",
    output_id: null,
    transcript_index: 2,
  },
  output: { availability: "retained", retained_start: "0", retained_end: "5" },
};

describe("recent execution facts", () => {
  it("preserves canonical known outcomes when collector/output enrichment is unavailable", () => {
    const missing = {
      ...record,
      execution: null,
      outcome: "spawn_error" as const,
      output: { availability: "process_local_unavailable" as const },
    };
    expect(historyOutcome(missing)).toBe("completed · exit 7");
    expect(historyOutputCopy(missing)).toContain("may have expired or been lost on server restart");
    expect(readOnlyHistorySource(missing)).toBeNull();
  });

  it("renders exact decimal retention gaps above JavaScript's safe integer range", () => {
    const gap = {
      ...record,
      output: {
        availability: "tail_gap" as const,
        retained_start: "9007199254740993",
        retained_end: "18446744073709551615",
      },
    };
    expect(historyOutputCopy(gap)).toContain("9007199254740993–18446744073709551615");
    expect(canReopenHistory(gap)).toBe(true);
  });

  it("strips interaction capabilities while preserving actual retention and source identity", () => {
    const live = {
      ...record,
      execution: {
        ...record.execution!,
        origin: "human" as const,
        input: true,
        resize: true,
        stop: true,
        retained: true,
      },
    };
    const source = readOnlyHistorySource(live)!;
    expect(source.id).toBe(live.execution.id);
    expect([source.input, source.resize, source.stop]).toEqual([false, false, false]);
    expect(source.retained).toBe(true);
    expect(live.execution.input).toBe(true);
    expect(readOnlyHistorySource({ ...live, output: { availability: "expired" } })).toBeNull();
  });

  it("keeps cleanup/collection and unconfirmed command outcomes distinct", () => {
    expect(
      historyOutcome({
        ...record,
        command: null,
        execution: {
          ...record.execution!,
          process_state: "cleanup_pending",
          output_complete: true,
        },
      }),
    ).toBe("Cleanup pending");
    expect(
      historyOutcome({
        ...record,
        command: { ...record.command!, state: "outcome_unknown", exit_code: null },
        execution: null,
      }),
    ).toBe("outcome unknown");
  });
});
