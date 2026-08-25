/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { DelegatedWorkView } from "@/app/components/inspector/DelegatedWorkView";
import { queryKeys } from "@/app/services/queries";
import type { ManagedOrchestratorRecord, TraditionalChildRecord } from "@/app/types/api";

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

const child: TraditionalChildRecord = {
  child_session_id: "child-1",
  parent_session_id: "parent",
  root_session_id: "parent",
  profile: "general",
  description: "Review permissions",
  nesting_depth: 1,
  status: "running",
  generation: 2,
  run_id: "child-run",
  execution_mode: "background",
  report: null,
  failure: null,
  change_summary: null,
  verification_summary: null,
  completion_inbox_id: null,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
  version: 3,
};

const orchestrator: ManagedOrchestratorRecord = {
  orchestrator_session_id: "orchestrator-1",
  parent_session_id: "parent",
  root_session_id: "parent",
  description: "Run the compatibility audit",
  status: "completed",
  generation: 1,
  run_id: "orchestrator-run",
  execution_mode: "foreground",
  report: "done",
  failure: null,
  completion_inbox_id: 4,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
  version: 2,
};

function mount(behavior: "direct" | "direct-with-orchestrator") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.traditionalChildren("parent"), [child]);
  client.setQueryData(queryKeys.managedOrchestrators("parent"), [orchestrator]);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/sessions/parent"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <DelegatedWorkView sessionId="parent" behavior={behavior} />
                <Location />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("delegated work", () => {
  it("keeps coding agents and managed orchestrators visibly distinct", () => {
    mount("direct-with-orchestrator");

    expect(screen.getByText("Traditional coding agents")).toBeTruthy();
    expect(screen.getByText("Review permissions")).toBeTruthy();
    expect(screen.getByText(/General coding agent · running · generation 2/)).toBeTruthy();
    expect(screen.getByText("Managed NAC orchestrators")).toBeTruthy();
    expect(screen.getByText("Run the compatibility audit")).toBeTruthy();
    expect(screen.getByText(/Separate NAC orchestrator · completed · generation 1/)).toBeTruthy();
  });

  it("navigates from a delegated row to its transcript", () => {
    mount("direct");

    fireEvent.click(screen.getByRole("button", { name: "Open transcript" }));
    expect(screen.getByTestId("location").textContent).toBe("/session/child-1/threads");
    expect(screen.queryByText("Managed NAC orchestrators")).toBeNull();
  });
});
