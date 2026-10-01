/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect } from "effect";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThreadsView } from "@/app/components/inspector/ThreadsView";
import { isolatedRegistry } from "@/app/effect/remote";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { apiEffect } from "@/app/services/api";
import { resetRuntime, runtimeStore } from "@/app/store/runtimeStore";
import { sessionLayoutStore } from "@/app/store/sessionLayoutStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

const viewport = vi.hoisted(() => ({ mobile: false, tablet: false }));

vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => viewport.mobile,
  useIsTablet: () => viewport.tablet,
}));

const getThreadEvents = vi.fn();
const steerThread = vi.fn();
vi.spyOn(apiEffect, "getThreadEvents").mockImplementation((...args) =>
  Effect.promise(() => getThreadEvents(...args)),
);
vi.spyOn(apiEffect, "steerThread").mockImplementation((...args) =>
  Effect.promise(() => steerThread(...args)),
);

function NavigateAway() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/sessions/next")}>Navigate away</button>;
}

function snapshot(activeThreads: string[] = ["worker"]): SessionSnapshotResponse {
  return {
    metadata: { session_id: "session", behavior: "orchestrator" },
    messages: [],
    threads: [
      {
        name: "worker",
        session_id: "session",
        created_at: "2026-09-24T00:00:00Z",
        updated_at: "2026-09-24T00:00:01Z",
        episode_count: 0,
        latest_action: "Inspect the steering seam",
      },
    ],
    active_threads: activeThreads,
    thread_episodes: {},
    thread_events: {},
  } as unknown as SessionSnapshotResponse;
}

function mount({
  phase = "running",
  canSteerWorkers = true,
  streamStatus = "live",
}: {
  phase?: "running" | "pending" | "terminal";
  canSteerWorkers?: boolean;
  streamStatus?: "live" | "reconnecting";
} = {}) {
  resetRuntime("session");
  runtimeStore.setState({
    streamStatus,
    threads:
      phase === "running"
        ? {
            worker: {
              name: "worker",
              status: "running",
              cancelled: false,
              exitCode: null,
              isError: false,
              log: [],
            },
          }
        : {},
  });
  const registry = isolatedRegistry();
  render(
    <RegistryContext.Provider value={registry}>
      <MemoryRouter>
        <ToastProvider>
          <NavigateAway />
          <ThreadsView
            snapshot={snapshot(phase === "terminal" ? [] : ["worker"])}
            selected="worker"
            onSelect={vi.fn()}
            canSteerWorkers={canSteerWorkers}
          />
        </ToastProvider>
      </MemoryRouter>
    </RegistryContext.Provider>,
  );
}

beforeEach(() => {
  viewport.mobile = false;
  viewport.tablet = false;
  sessionLayoutStore.setState({ panelList: false });
  getThreadEvents.mockReset().mockResolvedValue({
    events: [],
    has_older: false,
    next_before_id: null,
  });
  steerThread.mockReset().mockResolvedValue({
    steering_id: 7,
    thread_name: "worker",
    status: "queued",
    instruction_preview: "narrow the review",
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  resetRuntime(null);
  vi.unstubAllGlobals();
});

describe("classic worker steering", () => {
  it.each([
    ["desktop", false, false],
    ["tablet", false, true],
    ["mobile", true, false],
  ])("offers the selected active worker on %s", (_label, mobile, tablet) => {
    viewport.mobile = mobile;
    viewport.tablet = tablet;
    mount();

    expect(screen.getByRole("button", { name: "Steer" })).toBeTruthy();
  });

  it("submits the selected worker and retains a rejected race", async () => {
    steerThread.mockRejectedValueOnce(new Error("worker dispatch already finished"));
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    const field = screen.getByRole("textbox", { name: "Steering message" });
    fireEvent.change(field, { target: { value: "narrow the review" } });
    fireEvent.click(screen.getByRole("button", { name: "Send steering" }));

    expect(
      await screen.findByText(/Unable to steer worker: worker dispatch already finished/),
    ).toBeTruthy();
    expect(field).toHaveProperty("value", "narrow the review");
    expect(steerThread).toHaveBeenCalledWith("session", "worker", "narrow the review");
  });

  it("closes and clears only after the backend accepts the steering request", async () => {
    const accepted = Promise.withResolvers<{
      steering_id: number;
      thread_name: string;
      status: string;
      instruction_preview: string;
    }>();
    steerThread.mockReturnValueOnce(accepted.promise);
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    const field = screen.getByRole("textbox", { name: "Steering message" });
    fireEvent.change(field, { target: { value: "wait for acceptance" } });
    fireEvent.click(screen.getByRole("button", { name: "Send steering" }));
    expect(field).toHaveProperty("value", "wait for acceptance");

    accepted.resolve({
      steering_id: 8,
      thread_name: "worker",
      status: "queued",
      instruction_preview: "wait for acceptance",
    });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Steering message" })).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    expect(screen.getByRole("textbox", { name: "Steering message" })).toHaveProperty("value", "");
  });

  it("locks the steering draft and dismissal while backend acceptance is pending", async () => {
    const accepted = Promise.withResolvers<{
      steering_id: number;
      thread_name: string;
      status: string;
      instruction_preview: string;
    }>();
    steerThread.mockReturnValueOnce(accepted.promise);
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    const field = screen.getByRole("textbox", { name: "Steering message" });
    fireEvent.change(field, { target: { value: "keep this exact draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Send steering" }));

    await waitFor(() => expect(field).toHaveProperty("disabled", true));
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("textbox", { name: "Steering message" })).toHaveProperty(
      "value",
      "keep this exact draft",
    );

    accepted.resolve({
      steering_id: 9,
      thread_name: "worker",
      status: "queued",
      instruction_preview: "keep this exact draft",
    });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Steering message" })).toBeNull(),
    );
  });

  it("dismisses an in-flight steering modal when the route changes", async () => {
    const accepted = Promise.withResolvers<{
      steering_id: number;
      thread_name: string;
      status: string;
      instruction_preview: string;
    }>();
    steerThread.mockReturnValueOnce(accepted.promise);
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Steering message" }), {
      target: { value: "finish on the original route" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send steering" }));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Steering message" })).toHaveProperty(
        "disabled",
        true,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Navigate away" }));
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Steering message" })).toBeNull(),
    );
    expect(steerThread).toHaveBeenCalledWith("session", "worker", "finish on the original route");

    accepted.resolve({
      steering_id: 10,
      thread_name: "worker",
      status: "queued",
      instruction_preview: "finish on the original route",
    });
  });

  it("keeps all narrow-mobile thread controls in a horizontal scroll region", () => {
    viewport.mobile = true;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    mount();

    const controls = screen.getByRole("toolbar", { name: "Thread controls" });
    expect(controls.className).toContain("overflow-x-auto");
    expect(within(controls).getByRole("button", { name: "Command Log" })).toBeTruthy();
    expect(within(controls).getByRole("button", { name: "Episodes" })).toBeTruthy();
    expect(within(controls).getByRole("button", { name: "Task" })).toBeTruthy();
    expect(within(controls).getByRole("button", { name: "Steer" })).toBeTruthy();
  });

  it("hides steering for pending, terminal, and read-only workers", () => {
    mount({ phase: "pending" });
    expect(screen.queryByRole("button", { name: "Steer" })).toBeNull();

    cleanup();
    mount({ phase: "terminal" });
    expect(screen.queryByRole("button", { name: "Steer" })).toBeNull();

    cleanup();
    mount({ canSteerWorkers: false });
    expect(screen.queryByRole("button", { name: "Steer" })).toBeNull();
  });

  it("does not treat an active snapshot entry as steerable while SSE reconnects", () => {
    mount({ phase: "pending", streamStatus: "reconnecting" });

    expect(screen.queryByRole("button", { name: "Steer" })).toBeNull();
  });
});
