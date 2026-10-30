/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoalContinuationCard } from "@/app/features/goals/presentation/GoalContinuationCard";
import type { GoalContinuationTurn } from "@/app/lib/transcript";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { SessionGoalRecord } from "@/app/types/api";

const SESSION_ID = "direct-session";
const getGoal = vi.spyOn(api, "getGoal");

function turn(overrides: Partial<GoalContinuationTurn> = {}): GoalContinuationTurn {
  return {
    kind: "goal-continuation",
    key: "goal-continuation-0",
    goalId: "goal-1",
    objective: "Ship the embedded MVP",
    first: true,
    messageIndex: 0,
    createdAt: null,
    ...overrides,
  };
}

function mount(current: Partial<SessionGoalRecord> | null, value: GoalContinuationTurn) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const record =
    current && ({ goal_id: "goal-1", status: "active", ...current } as SessionGoalRecord);
  client.setQueryData(queryKeys.sessionGoal(SESSION_ID), record);
  getGoal.mockResolvedValue(record);
  render(
    <QueryClientProvider client={client}>
      <GoalContinuationCard sessionId={SESSION_ID} turn={value} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  getGoal.mockReset();
});

describe("goal continuation card", () => {
  it("names the goal run, its durable status and objective", () => {
    mount({ status: "paused" }, turn());
    const card = screen.getByRole("region", { name: "Goal started" });
    expect(card.textContent).toContain("Ship the embedded MVP");
    expect(card.textContent).toContain("Paused");
    expect(card.textContent).toContain("Goal goal-1");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("marks a later run and a goal that is no longer current", () => {
    mount({ goal_id: "goal-2" }, turn({ first: false }));
    const card = screen.getByRole("region", { name: "Goal continued" });
    expect(card.textContent).toContain("No longer current");
  });

  it("bounds a long objective until it is expanded", () => {
    const objective = Array.from({ length: 8 }, (_, line) => `step ${line + 1}`).join("\n");
    mount({}, turn({ objective }));
    const toggle = screen.getByRole("button", { name: "Show full objective" });
    const text = screen.getByText(/step 1/);
    expect(text.className).toContain("line-clamp-4");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(text.className).not.toContain("line-clamp-4");
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });
});
