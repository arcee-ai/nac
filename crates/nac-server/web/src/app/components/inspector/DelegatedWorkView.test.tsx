/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DelegatedWorkView } from "@/app/components/inspector/DelegatedWorkView";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { SessionAssignmentRecord } from "@/app/types/api";

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

const child: SessionAssignmentRecord = {
  assignment_id: "asgn_child-1",
  child_session_id: "child-1",
  parent_session_id: "parent",
  root_session_id: "parent",
  child_behavior: "direct",
  parent_behavior: "direct",
  description: "Review permissions",
  status: "running",
  generation: 2,
  run_id: "child-run",
  execution_mode: "background",
  report: null,
  failure: null,
  change_summary: null,
  verification_summary: null,
  completion_inbox_id: null,
  completion_suppressed: false,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
  version: 3,
  frozen_message_count: null,
};

const orchestrator: SessionAssignmentRecord = {
  assignment_id: "asgn_orchestrator-1",
  child_session_id: "orchestrator-1",
  parent_session_id: "parent",
  root_session_id: "parent",
  child_behavior: "orchestrator",
  parent_behavior: "direct",
  description: "Run the compatibility audit",
  status: "completed",
  generation: 1,
  run_id: "orchestrator-run",
  execution_mode: "foreground",
  report: "done",
  failure: null,
  change_summary: null,
  verification_summary: null,
  completion_inbox_id: 4,
  completion_suppressed: false,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
  version: 2,
  frozen_message_count: 6,
};

const listSpawns = vi.spyOn(api, "listSessionSpawns");
const startSpawn = vi.spyOn(api, "startSessionSpawn");
const cancelSpawn = vi.spyOn(api, "cancelSessionSpawn");

function mount(behavior: "direct" | "direct-with-orchestrator", seed = true) {
  window.matchMedia = () =>
    ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (seed) {
    client.setQueryData(queryKeys.sessionSpawns("parent"), [child, orchestrator]);
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/sessions/parent"]}>
        <Routes>
          <Route
            path="*"
            element={
              <ToastProvider>
                <DelegatedWorkView sessionId="parent" behavior={behavior} />
                <Location />
              </ToastProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  listSpawns.mockReset().mockResolvedValue([child, orchestrator]);
  startSpawn.mockReset().mockResolvedValue(child);
  cancelSpawn.mockReset().mockResolvedValue({ ...child, status: "cancelled" });
});
afterEach(cleanup);

describe("delegated work", () => {
  it("shows Agent and Orchestrator assignments in one list", () => {
    mount("direct-with-orchestrator");

    expect(screen.getByText("Assignments")).toBeTruthy();
    expect(screen.getByText("Review permissions")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Generation 2")).toBeTruthy();
    expect(screen.getByText("Run the compatibility audit")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy();
    expect(screen.getByText("Completion delivered to this parent")).toBeTruthy();
    expect(screen.queryByText("Coding agents")).toBeNull();
    expect(screen.queryByText("NAC orchestrators")).toBeNull();
  });

  it("navigates from a delegated row to its transcript", () => {
    mount("direct");

    const childRow = screen.getByRole("article", { name: "Coding agent: Review permissions" });
    fireEvent.click(within(childRow).getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("location").textContent).toBe("/session/child-1/threads");
    expect(screen.getByText("Run the compatibility audit")).toBeTruthy();
  });

  it("keeps a recoverable retry entry point after a relationship-list failure", async () => {
    listSpawns.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValue([child]);
    mount("direct", false);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Delegated work could not be loaded",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Review permissions")).toBeTruthy());
    expect(listSpawns).toHaveBeenCalledTimes(2);
  });

  it("routes steering, continuation, and cancellation through the unified spawn API", async () => {
    mount("direct-with-orchestrator");
    const childRow = screen.getByRole("article", { name: "Coding agent: Review permissions" });
    const orchestratorRow = screen.getByRole("article", {
      name: "Orchestrator: Run the compatibility audit",
    });

    fireEvent.click(within(childRow).getByRole("button", { name: "Steer" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Steering message" }), {
      target: { value: "Check the remembered grant." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send steering" }));
    await waitFor(() =>
      expect(startSpawn).toHaveBeenCalledWith("parent", {
        behavior: "direct",
        child_session_id: "child-1",
        description: "Review permissions",
        prompt: "Check the remembered grant.",
        background: true,
      }),
    );

    fireEvent.click(within(childRow).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancelSpawn).toHaveBeenCalledWith("parent", "child-1"));

    fireEvent.click(within(orchestratorRow).getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Continuation prompt" }), {
      target: { value: "Run the next audit generation." },
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(startSpawn).toHaveBeenCalledWith("parent", {
        behavior: "orchestrator",
        child_session_id: "orchestrator-1",
        description: "Run the compatibility audit",
        prompt: "Run the next audit generation.",
        background: false,
      }),
    );
  });

  it("renders cache-driven polling transitions without a page refresh", async () => {
    const client = mount("direct");
    const row = screen.getByRole("article", { name: "Coding agent: Review permissions" });
    expect(within(row).getByRole("status").textContent).toBe("Running");

    act(() => {
      client.setQueryData(queryKeys.sessionSpawns("parent"), [
        {
          ...child,
          status: "completed",
          report: "The permissions audit passed.",
          completion_inbox_id: 12,
        },
        orchestrator,
      ]);
    });

    await waitFor(() =>
      expect(within(row).getByText("Completed").getAttribute("role")).toBe("status"),
    );
    expect(within(row).getByText("The permissions audit passed.")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
