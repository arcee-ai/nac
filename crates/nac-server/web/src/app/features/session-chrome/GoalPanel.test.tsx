/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GoalPanel } from "@/app/features/session-chrome/GoalPanel";
import type { SessionGoalRecord } from "@/app/types/api";

const state = vi.hoisted(() => ({
  goal: null as SessionGoalRecord | null,
  update: vi.fn(async () => ({})),
  clear: vi.fn(async () => ({})),
  create: vi.fn(async () => ({})),
}));

vi.mock("@/app/services/queries", () => ({
  useSessionGoal: () => ({
    data: state.goal,
    isPending: false,
    isError: false,
  }),
  useUpdateGoal: () => ({ mutateAsync: state.update, isPending: false }),
  useClearGoal: () => ({ mutateAsync: state.clear, isPending: false }),
  useCreateGoal: () => ({ mutateAsync: state.create, isPending: false }),
}));
vi.mock("@/app/providers/ToastProvider", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
  errorMessage: () => "failed",
}));
vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
  useMediaQuery: () => false,
}));

const goal = {
  goal_id: "g1",
  version: 4,
  objective: "Ship the drawer",
  status: "active",
  tokens_used: 1200,
  token_budget: 10000,
  time_used_ms: 61_000,
  last_failure: null,
} as unknown as SessionGoalRecord;

beforeEach(() => {
  state.goal = goal;
  state.update.mockClear();
  state.clear.mockClear();
  state.create.mockClear();
});
afterEach(cleanup);

describe("goal drawer", () => {
  it("shows the objective and budget, and pauses through the versioned update", async () => {
    render(<GoalPanel sessionId="s1" enabled />);
    expect(screen.getByText("Ship the drawer")).toBeTruthy();
    expect(
      screen.getByRole("meter", { name: "Token budget used" }).getAttribute("aria-valuenow"),
    ).toBe("12");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({
        sessionId: "s1",
        goalId: "g1",
        payload: { expected_version: 4, status: "paused" },
      }),
    );
  });

  it("resumes a paused goal and clears with the expected version", async () => {
    state.goal = { ...goal, status: "paused" } as SessionGoalRecord;
    render(<GoalPanel sessionId="s1" enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { expected_version: 4, status: "active" },
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() =>
      expect(state.clear).toHaveBeenCalledWith({
        sessionId: "s1",
        goalId: "g1",
        expectedVersion: 4,
      }),
    );
  });

  it("edits the objective and budget in place", async () => {
    render(<GoalPanel sessionId="s1" enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Objective"), {
      target: { value: "Ship it all" },
    });
    fireEvent.change(screen.getByLabelText("Token budget (optional)"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({
        sessionId: "s1",
        goalId: "g1",
        payload: {
          expected_version: 4,
          objective: "Ship it all",
          token_budget: null,
        },
      }),
    );
  });

  it("keeps an untouched stored budget the field cannot send on an objective-only edit", async () => {
    state.goal = { ...goal, token_budget: 2 ** 53 } as SessionGoalRecord;
    render(<GoalPanel sessionId="s1" enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Objective"), {
      target: { value: "Ship it all" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({
        sessionId: "s1",
        goalId: "g1",
        payload: { expected_version: 4, objective: "Ship it all" },
      }),
    );
  });

  it("edits the goal it loaded, so a goal changed elsewhere refuses the stale edit", async () => {
    const view = render(<GoalPanel sessionId="s1" enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    // Another tab rewrites the objective while this edit is open.
    state.goal = {
      ...goal,
      version: 6,
      objective: "Something else",
    } as SessionGoalRecord;
    view.rerender(<GoalPanel sessionId="s1" enabled />);
    fireEvent.change(screen.getByLabelText("Objective"), {
      target: { value: "Ship it all" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({
        sessionId: "s1",
        goalId: "g1",
        payload: { expected_version: 4, objective: "Ship it all" },
      }),
    );
  });
});
