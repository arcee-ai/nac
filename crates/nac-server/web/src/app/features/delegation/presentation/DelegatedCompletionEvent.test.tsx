/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { DelegatedCompletionEvent } from "@/app/features/delegation/presentation/DelegatedCompletionEvent";

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

afterEach(cleanup);

describe("delegated completion event", () => {
  it("renders structured status and an exact link without user/model actions", () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <DelegatedCompletionEvent
                  turn={{
                    kind: "delegated-completion",
                    key: "event-1",
                    messageIndex: 9,
                    createdAt: null,
                    completion: {
                      kind: "coding-agent",
                      sessionId: "child/exact",
                      generation: 2,
                      status: "completed",
                      description: "Audit persistence",
                      outcome: "All checks passed",
                      changes: null,
                      verification: "Vitest passed",
                    },
                  }}
                />
                <Location />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Coding agent completed: Audit persistence",
    );
    expect(screen.getByText("Generation 2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert to this snapshot" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create fork" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open exact transcript" }));
    expect(screen.getByTestId("location").textContent).toBe("/session/child%2Fexact/threads");
  });
});
