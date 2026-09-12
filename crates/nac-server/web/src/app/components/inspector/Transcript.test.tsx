/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunFailureNotice, TranscriptRecoveryNotice } from "@/app/components/inspector/Transcript";
import { failureRecoveryAffordance } from "@/app/lib/runFailure";
import type { RunFailure, SessionGoalRecord } from "@/app/types/api";

describe("TranscriptRecoveryNotice", () => {
  it("renders a non-fatal recovery status only when supplied", () => {
    const warning =
      "Recovered this session to its last valid message because transcript index 7 was missing.";
    const view = render(<TranscriptRecoveryNotice warning={warning} />);

    const status = view.getByRole("status");
    expect(status.textContent).toContain("Session recovered");
    expect(status.textContent).toContain(warning);

    view.rerender(<TranscriptRecoveryNotice warning={null} />);
    expect(view.queryByRole("status")).toBeNull();
  });
});

describe("RunFailureNotice", () => {
  it("never maps state-preserving goal resume to destructive regeneration", () => {
    const failure: RunFailure = {
      kind: "transport",
      phase: "stream",
      transient: true,
      attempt_count: 10,
      summary: "interrupted",
      diagnostic: "unexpected EOF",
      recovery_action: "resume_goal",
    };

    expect(failureRecoveryAffordance(failure, null, true)).toBeNull();
    expect(
      failureRecoveryAffordance(
        failure,
        {
          session_id: "session",
          goal_id: "goal",
          objective: "finish",
          status: "blocked",
          token_budget: null,
          tokens_used: 0,
          time_used_ms: 0,
          accounting_run_id: null,
          accounting_token_baseline: null,
          accounting_started_at_epoch_ms: null,
          continuation_run_id: null,
          consecutive_transient_failures: 3,
          next_attempt_at_epoch_ms: null,
          last_failure: failure,
          created_at: "now",
          updated_at: "now",
          version: 4,
        },
        true,
      ),
    ).toBe("resume_goal");
  });

  it("renders partial-output failure metadata as one actionable alert with diagnostics", () => {
    const failure: RunFailure = {
      kind: "transport",
      phase: "stream",
      transient: true,
      partial_output: { text: true, reasoning: false, tool_call: false },
      attempt_count: 10,
      summary: "The connection ended after a partial model response.",
      diagnostic: "unexpected EOF during chunk size line",
      recovery_action: "regenerate_with_rewind",
    };
    const view = render(
      <RunFailureNotice
        failure={failure}
        action={{ label: "Regenerate from original prompt", onClick: () => undefined }}
      />,
    );

    const alert = view.getByRole("alert");
    expect(alert.textContent).toContain("Run stopped after a partial response");
    expect(alert.textContent).toContain("unexpected EOF during chunk size line");
    expect(view.getByRole("button", { name: "Regenerate from original prompt" })).toBeTruthy();
    expect(alert.textContent).not.toContain("Session recovered");
  });

  it("does not describe a blocked authentication failure as exhausted retries", () => {
    const failure: RunFailure = {
      kind: "authentication",
      phase: "response",
      transient: false,
      attempt_count: 1,
      summary: "The model provider rejected authentication.",
      diagnostic: "HTTP 401",
      recovery_action: "settings",
    };
    const view = render(
      <RunFailureNotice failure={failure} goal={{ status: "blocked" } as SessionGoalRecord} />,
    );

    const alert = view.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(failure.summary);
    expect(alert?.textContent).not.toContain("repeated run failures");
  });
});
