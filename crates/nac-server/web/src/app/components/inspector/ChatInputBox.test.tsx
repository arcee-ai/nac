import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatInputBox } from "@/app/components/inspector/ChatInputBox";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { resetRuntime, syncRunFromSnapshot } from "@/app/store/runtimeStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

const stopRun = vi.fn();

vi.mock("@/app/providers/SessionActionsProvider", () => ({
  useSessionActions: () => ({
    settings: vi.fn(),
    stopRun,
  }),
}));

vi.mock("@/app/services/queries", () => ({
  useSubmitRun: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useGuideCurrentRun: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useModelCatalog: () => ({ data: undefined }),
  useSshConnect: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

function snapshot(queued = false): SessionSnapshotResponse {
  return {
    metadata: {
      session_id: "session-1",
      model: "test-model",
      backend: "test",
    },
    response_timing: {
      last_response_duration_ms: null,
      previous_response_duration_ms: null,
      response_durations_ms: [],
    },
    active_run: {
      run_id: "run-1",
      prompt_preview: "working",
      started_at_epoch_ms: Date.now(),
    },
    queued_message: queued
      ? {
          session_id: "session-1",
          queued_run_id: "queued-1",
          client_message_id: "client-1",
          display_prompt: "already next",
          agent_prompt: "already next",
          after_run_id: "run-1",
          state: "pending",
          admitted_run_id: null,
          version: 1,
          created_at: "now",
          updated_at: "now",
        }
      : undefined,
    thread_steering: [],
  } as unknown as SessionSnapshotResponse;
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("max-width: 767.98px"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  resetRuntime("session-1");
});

afterEach(() => {
  resetRuntime(null);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("responsive running composer", () => {
  it("keeps separate stop, next-turn send, and guidance controls on mobile", () => {
    const value = snapshot();
    syncRunFromSnapshot(value.active_run);

    render(
      <ToastProvider>
        <ChatInputBox sessionId="session-1" snapshot={value} entry={null} />
      </ToastProvider>,
    );

    expect(screen.getByRole("button", { name: "Stop run" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send next message" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sends after the current run finishes")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guide current run" }),
    ).toBeInTheDocument();
  });

  it("disables only next-turn send when the durable queue slot is occupied", () => {
    const value = snapshot(true);
    syncRunFromSnapshot(value.active_run);

    render(
      <ToastProvider>
        <ChatInputBox sessionId="session-1" snapshot={value} entry={null} />
      </ToastProvider>,
    );

    expect(screen.getByRole("button", { name: "Stop run" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send next message" })).toBeDisabled();
    expect(screen.getByText("A next message is already queued")).toBeInTheDocument();
  });
});
