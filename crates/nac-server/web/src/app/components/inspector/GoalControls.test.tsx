/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GoalControls } from "@/app/components/inspector/GoalControls";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { SessionGoalRecord } from "@/app/types/api";

const SESSION_ID = "direct-session";

const fakes = {
  getGoal: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  clearGoal: vi.fn(),
};

vi.spyOn(api, "getGoal").mockImplementation((...args) => fakes.getGoal(...args));
vi.spyOn(api, "createGoal").mockImplementation((...args) => fakes.createGoal(...args));
vi.spyOn(api, "updateGoal").mockImplementation((...args) => fakes.updateGoal(...args));
vi.spyOn(api, "clearGoal").mockImplementation((...args) => fakes.clearGoal(...args));

function goal(status: SessionGoalRecord["status"] = "active"): SessionGoalRecord {
  return {
    session_id: SESSION_ID,
    goal_id: "goal-1",
    objective: "Ship safely",
    status,
    token_budget: 500,
    tokens_used: 120,
    time_used_ms: 3_000,
    accounting_run_id: null,
    accounting_token_baseline: null,
    accounting_started_at_epoch_ms: null,
    continuation_run_id: null,
    created_at: "2026-08-24T00:00:00Z",
    updated_at: "2026-08-24T00:00:00Z",
    version: 4,
  };
}

function mount(value: SessionGoalRecord | null, behavior: "direct" | "orchestrator" = "direct") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.sessionGoal(SESSION_ID), value);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <GoalControls sessionId={SESSION_ID} behavior={behavior} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fakes.getGoal.mockReset().mockResolvedValue(null);
  fakes.createGoal.mockReset().mockImplementation(async () => goal());
  fakes.updateGoal.mockReset().mockImplementation(async () => goal("paused"));
  fakes.clearGoal.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("durable goal controls", () => {
  it("creates an explicit goal with an optional budget", async () => {
    mount(null);
    fireEvent.click(screen.getByRole("button", { name: "Create durable goal" }));
    const [objective, budget] = screen.getAllByRole("textbox");
    fireEvent.change(objective, { target: { value: "Finish MVP" } });
    fireEvent.change(budget, { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and start" }));

    await waitFor(() =>
      expect(fakes.createGoal).toHaveBeenCalledWith(SESSION_ID, {
        objective: "Finish MVP",
        token_budget: 900,
      }),
    );
  });

  it("shows accounting and sends versioned pause and clear controls", async () => {
    mount(goal());
    fireEvent.click(screen.getByRole("button", { name: "Goal: active" }));
    expect(screen.getByRole("dialog").textContent).toContain("120 tokens");
    expect(screen.getByRole("dialog").textContent).toContain("380 tokens remaining");

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() =>
      expect(fakes.updateGoal).toHaveBeenCalledWith(SESSION_ID, "goal-1", {
        expected_version: 4,
        status: "paused",
      }),
    );
  });

  it("replaces a completed goal through the create contract", async () => {
    mount(goal("complete"));
    fireEvent.click(screen.getByRole("button", { name: "Goal: complete" }));
    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "Ship the next milestone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace and start" }));

    await waitFor(() =>
      expect(fakes.createGoal).toHaveBeenCalledWith(SESSION_ID, {
        objective: "Ship the next milestone",
        token_budget: 500,
      }),
    );
    expect(fakes.updateGoal).not.toHaveBeenCalled();
  });

  it("does not fetch or render for orchestrator sessions", () => {
    mount(null, "orchestrator");
    expect(screen.queryByRole("button", { name: "Create durable goal" })).toBeNull();
    expect(fakes.getGoal).not.toHaveBeenCalled();
  });
});
