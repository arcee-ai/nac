/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionsView } from "@/app/components/inspector/ActionsView";
import { resetActionExpansion } from "@/app/lib/actionExpand";
import { sessionLayoutStore } from "@/app/store/sessionLayoutStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

const transcript = vi.hoisted(() => [
  {
    kind: "user" as const,
    key: "user-1",
    text: "Ship the responsive inspector",
    invokedSkills: null,
    messageIndex: 0,
    createdAt: null,
  },
  {
    kind: "model" as const,
    key: "model-1",
    durationMs: 500,
    messageIndex: 1,
    blocks: [
      {
        kind: "thoughts" as const,
        key: "thought-1",
        text: "Inspect the current panel policy.",
        durationMs: 200,
        streaming: false,
      },
      { kind: "tool" as const, key: "tool-1", name: "read", pending: false },
      {
        kind: "workset" as const,
        key: "workset-1",
        worksetId: "ui",
        pending: false,
      },
      {
        kind: "wave" as const,
        key: "wave-1",
        rows: [
          [
            {
              key: "thread-1",
              name: "review",
              action: "Review responsive behavior",
              weight: null,
              summary: "Done",
              log: [],
              state: "done" as const,
            },
          ],
        ],
      },
    ],
  },
]);

vi.mock("@/app/lib/transcript", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/transcript")>();
  return {
    ...actual,
    buildTranscript: () => transcript,
    withStreamedOutput: (turns: unknown) => turns,
  };
});
vi.mock("@/app/store/runtimeStore", () => ({
  useLiveThreads: () => ({}),
  useFinishedToolCalls: () => ({}),
  usePrimaryToolEvents: () => [],
  useStreamText: () => "",
  useStreamReasoning: () => "",
}));
vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const snapshot = {
  metadata: { session_id: "session-a", behavior: "orchestrator" },
  threads: [{ name: "review", episode_count: 1 }],
  thread_episodes: { review: [{}] },
} as unknown as SessionSnapshotResponse;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  resetActionExpansion();
  sessionLayoutStore.setState({
    selectedActionGroup: null,
    selectedThread: null,
    selectedThreadEpisode: null,
    selectedWorkset: null,
    panelList: false,
  });
});

afterEach(() => {
  cleanup();
  resetActionExpansion();
  vi.unstubAllGlobals();
});

describe("ActionsView", () => {
  it("projects the current transcript and keeps tool details in the Actions panel", () => {
    render(<ActionsView snapshot={snapshot} onPanelChange={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Turn 1" })).toBeTruthy();
    expect(screen.getByText("Inspect the current panel policy.")).toBeTruthy();
    expect(sessionLayoutStore.getState().selectedActionGroup).toBe("model-1:tools-0");
  });

  it("hands thread and workset rows to their existing panels", () => {
    const onPanelChange = vi.fn();
    render(<ActionsView snapshot={snapshot} onPanelChange={onPanelChange} />);

    fireEvent.click(screen.getByRole("button", { name: /review/ }));
    expect(sessionLayoutStore.getState()).toMatchObject({
      selectedThread: "review",
      selectedThreadEpisode: "thread-1",
    });
    expect(onPanelChange).toHaveBeenCalledWith("threads");

    fireEvent.click(screen.getByRole("button", { name: /Worksets_ui/ }));
    expect(sessionLayoutStore.getState().selectedWorkset).toBe("ui");
    expect(onPanelChange).toHaveBeenCalledWith("worksets");
  });
});
