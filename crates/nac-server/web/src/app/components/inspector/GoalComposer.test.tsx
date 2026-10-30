/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GoalEditor } from "@/app/components/inspector/GoalComposer";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api, ApiError } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { SessionGoalRecord } from "@/app/types/api";

const SESSION_ID = "direct-session";

const fakes = {
  getGoal: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  clearGoal: vi.fn(),
};

vi.spyOn(api, "getGoal").mockImplementation((...args) =>
  fakes.getGoal(...args),
);
vi.spyOn(api, "createGoal").mockImplementation((...args) =>
  fakes.createGoal(...args),
);
vi.spyOn(api, "updateGoal").mockImplementation((...args) =>
  fakes.updateGoal(...args),
);
vi.spyOn(api, "clearGoal").mockImplementation((...args) =>
  fakes.clearGoal(...args),
);

function goal(overrides: Partial<SessionGoalRecord> = {}): SessionGoalRecord {
  return {
    session_id: SESSION_ID,
    goal_id: "goal-1",
    objective: "Ship safely",
    status: "active",
    token_budget: null,
    tokens_used: 120,
    time_used_ms: 3_000,
    accounting_run_id: null,
    accounting_token_baseline: null,
    accounting_started_at_epoch_ms: null,
    continuation_run_id: null,
    consecutive_transient_failures: 0,
    next_attempt_at_epoch_ms: null,
    last_failure: null,
    created_at: "2026-08-24T00:00:00Z",
    updated_at: "2026-08-24T00:00:00Z",
    version: 4,
    ...overrides,
  };
}

function mount(value: SessionGoalRecord | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.sessionGoal(SESSION_ID), value);
  fakes.getGoal.mockImplementation(async () =>
    client.getQueryData(queryKeys.sessionGoal(SESSION_ID)),
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <GoalEditor
            sessionId={SESSION_ID}
            compact={false}
            onClose={() => {}}
          />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

const objectiveField = () =>
  screen.getByRole("textbox", { name: "Goal objective" });
const amountField = () =>
  screen.getByRole("textbox", { name: "Token budget amount" });

beforeEach(() => {
  fakes.getGoal.mockReset().mockResolvedValue(null);
  fakes.createGoal
    .mockReset()
    .mockImplementation(async (_session, payload) =>
      goal({
        objective: payload.objective,
        token_budget: payload.token_budget ?? null,
      }),
    );
  fakes.updateGoal
    .mockReset()
    .mockImplementation(async () => goal({ version: 5 }));
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

describe("goal editor token budget", () => {
  it("starts with no token limit, hides the amount, and omits the budget", async () => {
    mount(null);
    expect(
      screen
        .getByRole("switch", { name: "Token budget" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.getByText("No token limit")).toBeTruthy();
    expect(
      screen.queryByRole("textbox", { name: "Token budget amount" }),
    ).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();

    fireEvent.change(objectiveField(), { target: { value: "Finish MVP" } });
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));

    await waitFor(() => expect(fakes.createGoal).toHaveBeenCalledTimes(1));
    expect(fakes.createGoal.mock.calls[0]?.[1]).toStrictEqual({
      objective: "Finish MVP",
    });
  });

  it("explains an enabled budget as billable usage across the goal's runs", () => {
    mount(null);
    fireEvent.click(screen.getByRole("switch", { name: "Token budget" }));

    const explanation = screen.getByText(
      /total billable tokens all of this goal's runs/,
    );
    expect(explanation.textContent).toContain("not the model's context size");
    expect(explanation.textContent).toContain("not a cost guarantee");
    expect(amountField()).toBeTruthy();
    expect(
      screen.getByRole("slider", { name: "Token budget slider" }),
    ).toBeTruthy();
    expect(screen.queryByText("No token limit")).toBeNull();
  });

  it("accepts an amount above the slider maximum and keeps it on reload", async () => {
    mount(null);
    fireEvent.change(objectiveField(), { target: { value: "Finish MVP" } });
    fireEvent.click(screen.getByRole("switch", { name: "Token budget" }));
    fireEvent.change(amountField(), { target: { value: "2,500,000" } });

    const slider = screen.getByRole("slider", { name: "Token budget slider" });
    expect(slider.getAttribute("aria-valuenow")).toBe("1000000");
    expect(
      screen.getByText(/above the slider's range and kept as entered/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
    await waitFor(() =>
      expect(fakes.createGoal).toHaveBeenCalledWith(SESSION_ID, {
        objective: "Finish MVP",
        token_budget: 2_500_000,
      }),
    );

    cleanup();
    mount(goal({ objective: "Finish MVP", token_budget: 2_500_000 }));
    expect(
      screen
        .getByRole("switch", { name: "Token budget" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(amountField()).toHaveProperty("value", "2500000");
  });

  it("blocks an amount that is not a whole number", () => {
    mount(null);
    fireEvent.change(objectiveField(), { target: { value: "Finish MVP" } });
    fireEvent.click(screen.getByRole("switch", { name: "Token budget" }));
    fireEvent.change(amountField(), { target: { value: "lots" } });

    expect(screen.getByRole("alert").textContent).toBe(
      "Enter a whole number of tokens up to 9,007,199,254,740,991.",
    );
    expect(screen.getByRole("button", { name: "Create goal" })).toHaveProperty(
      "disabled",
      true,
    );

    // A whole number too large to send exactly says why, not "not a number".
    fireEvent.change(amountField(), {
      target: { value: "9223372036854775808" },
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "Enter a whole number of tokens up to 9,007,199,254,740,991.",
    );
  });

  it("leaves a budget outside the slider range alone on an objective-only edit", async () => {
    mount(goal({ token_budget: 5_000_000 }));
    expect(amountField()).toHaveProperty("value", "5000000");

    fireEvent.change(objectiveField(), {
      target: { value: "Ship safely, then document" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fakes.updateGoal).toHaveBeenCalledTimes(1));
    expect(fakes.updateGoal.mock.calls[0]).toStrictEqual([
      SESSION_ID,
      "goal-1",
      { expected_version: 4, objective: "Ship safely, then document" },
    ]);
  });
});

describe("goal editor versioning", () => {
  it("uses the current version when only run accounting moved", async () => {
    const client = mount(goal());
    client.setQueryData(
      queryKeys.sessionGoal(SESSION_ID),
      goal({ version: 6, tokens_used: 900 }),
    );

    fireEvent.change(objectiveField(), {
      target: { value: "Ship safely, then document" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(fakes.updateGoal).toHaveBeenCalledWith(SESSION_ID, "goal-1", {
        expected_version: 6,
        objective: "Ship safely, then document",
      }),
    );
  });

  it("sends the loaded version for a goal changed elsewhere and shows the rejection", async () => {
    const client = mount(goal());
    client.setQueryData(
      queryKeys.sessionGoal(SESSION_ID),
      goal({ objective: "Changed in another tab", version: 6 }),
    );
    fakes.updateGoal.mockRejectedValueOnce(
      new ApiError(
        409,
        "PATCH",
        `/sessions/${SESSION_ID}/goal/goal-1`,
        "goal version conflict: expected 4, current 6",
        "stale",
      ),
    );

    fireEvent.change(objectiveField(), { target: { value: "My stale edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(fakes.updateGoal).toHaveBeenCalledWith(SESSION_ID, "goal-1", {
        expected_version: 4,
        objective: "My stale edit",
      }),
    );
    expect(
      await screen.findByText(/goal version conflict: expected 4, current 6/),
    ).toBeTruthy();
  });
});
