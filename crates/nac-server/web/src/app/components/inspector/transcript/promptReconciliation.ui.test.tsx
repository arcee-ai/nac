/** @vitest-environment jsdom */
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ModelMessage } from "@/app/components/inspector/ModelMessage";
import { TranscriptTurnsContext } from "@/app/features/insights/transcript/transcriptTurns";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { createRuntimeStore } from "@/app/store/runtimeStore";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import type { SessionSnapshotResponse } from "@/app/types/api";
import { useTranscriptModel } from "./useTranscriptModel";
import { WorkFoldView } from "./WorkFold";

vi.mock("@/app/services/queries", () => ({
  useSessionPermissions: () => ({ data: undefined }),
  queryKeys: { sessionSnapshot: (id: string) => [id] },
}));
vi.mock("@/app/features/insights/useInsightsNavigation", () => ({
  INSIGHTS_DETAIL_ID: "detail",
  useInsightsNavigation: () => ({ openGroup: vi.fn() }),
}));
afterEach(cleanup);
const store = standaloneRuntime.stores.runtimeStore;
const base = {
  metadata: { session_id: "s", behavior: "direct" },
  messages: [
    { role: "user", content: "question" },
    { role: "assistant", content: null },
  ],
  message_created_at: [null, null],
  message_page: { start: 0, end: 2, total: 2, has_older: false },
  response_timing: { response_durations_ms: [] },
  active_run: null,
} as unknown as SessionSnapshotResponse;

function View({ snapshot }: { snapshot: SessionSnapshotResponse }) {
  const model = useTranscriptModel("s", snapshot);
  useEffect(() => {
    if (!model.showPending && model.optimisticPromptToken != null) {
      store.retireOptimisticPrompt(model.optimisticPromptToken);
    }
  }, [model.showPending, model.optimisticPromptToken]);
  return (
    <MemoryRouter>
      <TranscriptTurnsContext value={{ sessionId: "s", turns: model.turns }}>
        {model.turns
          .filter((turn) => turn.kind === "model")
          .map((turn) => (
            <WorkFoldView
              key={turn.key}
              turnKey={turn.key}
              active
              turnDurationMs={null}
              selectedGroupId={null}
              interactive={false}
              liveLabel="Thinking…"
              fold={{
                kind: "fold",
                key: "fold:thoughts-0",
                groupIds: ["group"],
                steps: [
                  {
                    kind: "segment",
                    key: "thoughts-0",
                    groupId: "group",
                    segment: {
                      kind: "reasoning",
                      key: "thoughts-0",
                      text: "reasoning",
                      durationMs: null,
                      streaming: true,
                    },
                  },
                ],
              }}
            />
          ))}
      </TranscriptTurnsContext>
    </MemoryRouter>
  );
}

it.each(["before", "after"])("keeps disclosures open when events arrive %s acceptance", (order) => {
  store.resetRuntime("s");
  act(() => {
    const token = store.setOptimisticUserPrompt("question")!;
    if (order === "after") store.bindOptimisticPrompt(token, "run-a");
    store.applyEnvelope({
      sequence_id: 1,
      run_id: "run-a",
      event: { type: "run_started", started_at_epoch_ms: 1 },
    } as never);
    store.applyAssistantDelta({ run_id: "run-a", reasoning: "reasoning" });
    if (order === "before") store.bindOptimisticPrompt(token, "run-a");
    store.applyEnvelope({
      sequence_id: 2,
      run_id: "run-a",
      event: { type: "run_completed", response: "answer" },
    } as never);
  });
  const view = render(<View snapshot={base} />);
  const outer = screen.getAllByRole("button", { name: "Thinking…" }).at(-1)!;
  fireEvent.click(outer);
  const steps = screen.getAllByRole("list", { name: "Steps" }).at(-1)!;
  fireEvent.click(within(steps).getByRole("button", { name: "Thinking…" }));
  expect(within(steps).getByText("reasoning")).toBeTruthy();
  view.rerender(
    <View
      snapshot={{
        ...base,
        committed_prompt: { run_id: "run-a", canonical_index: 0 },
      }}
    />,
  );
  expect(store.getRuntimeState().optimisticPromptToken).toBeNull();
  expect(screen.getAllByRole("button", { name: "Thinking…", expanded: true })).toHaveLength(2);
  const provenSteps = screen.getByRole("list", { name: "Steps" });
  expect(
    within(provenSteps).getByRole("button", {
      name: "Thinking…",
      expanded: true,
    }),
  ).toBeTruthy();
  expect(within(provenSteps).getByText("reasoning")).toBeTruthy();
});

it("does not reuse a provisional reply key after same-session runtime replacement", () => {
  const first = createRuntimeStore();
  const second = createRuntimeStore();
  for (const runtime of [first, second]) {
    runtime.resetRuntime("s");
    const token = runtime.setOptimisticUserPrompt("question")!;
    runtime.bindOptimisticPrompt(token, "run-a");
    runtime.applyAssistantDelta({ run_id: "run-a", reasoning: "reasoning" });
  }
  function Probe() {
    const model = useTranscriptModel("s", base);
    return <div data-testid="reply-key">{model.turns.at(-1)?.key}</div>;
  }
  const value = (runtimeStore: typeof first) => ({
    ...standaloneRuntime,
    stores: { ...standaloneRuntime.stores, runtimeStore },
  });
  const view = render(
    <RuntimeContext value={value(first)}>
      <Probe />
    </RuntimeContext>,
  );
  const firstKey = screen.getByTestId("reply-key").textContent;
  view.rerender(
    <RuntimeContext value={value(second)}>
      <Probe />
    </RuntimeContext>,
  );
  expect(screen.getByTestId("reply-key").textContent).not.toBe(firstKey);
});

it("does not transfer a previous activation's reply on a same-session reopen", () => {
  const runtimeStore = createRuntimeStore();
  runtimeStore.resetRuntime("s");
  const token = runtimeStore.setOptimisticUserPrompt("question")!;
  runtimeStore.bindOptimisticPrompt(token, "run-a");
  runtimeStore.applyAssistantDelta({ run_id: "run-a", reasoning: "reasoning" });
  const value = { ...standaloneRuntime, stores: { ...standaloneRuntime.stores, runtimeStore } };
  function Probe({ snapshot }: { snapshot: SessionSnapshotResponse }) {
    const model = useTranscriptModel("s", snapshot);
    return <div data-testid="reply-key">{model.turns.at(-1)?.key}</div>;
  }
  const view = render(
    <RuntimeContext value={value}>
      <Probe snapshot={base} />
    </RuntimeContext>,
  );
  const oldKey = screen.getByTestId("reply-key").textContent;
  act(() => {
    runtimeStore.release();
    runtimeStore.resetRuntime("s");
    runtimeStore.applyAssistantDelta({ run_id: "run-a", reasoning: "late" });
  });
  view.rerender(
    <RuntimeContext value={value}>
      <Probe snapshot={{ ...base, committed_prompt: { run_id: "run-a", canonical_index: 0 } }} />
    </RuntimeContext>,
  );
  expect(screen.getByTestId("reply-key").textContent).not.toBe(oldKey);
});

it("keeps the real model disclosure open when proof reveals an earlier tool", () => {
  store.resetRuntime("s");
  act(() => {
    const token = store.setOptimisticUserPrompt("question")!;
    store.bindOptimisticPrompt(token, "run-a");
    store.applyEnvelope({
      sequence_id: 1,
      run_id: "run-a",
      event: { type: "run_started", started_at_epoch_ms: 1 },
    } as never);
    store.applyAssistantDelta({ run_id: "run-a", reasoning: "Live thought" });
  });
  const empty = {
    ...base,
    messages: [],
    message_created_at: [],
    message_page: { start: 0, end: 0, total: 0, has_older: false },
  };
  function RealView({ snapshot }: { snapshot: SessionSnapshotResponse }) {
    const model = useTranscriptModel("s", snapshot);
    useEffect(() => {
      if (!model.showPending && model.optimisticPromptToken != null)
        store.retireOptimisticPrompt(model.optimisticPromptToken);
    }, [model.showPending, model.optimisticPromptToken]);
    return (
      <MemoryRouter>
        <TranscriptTurnsContext value={{ sessionId: "s", turns: model.turns }}>
          {model.turns.map((turn) =>
            turn.kind === "model" ? (
              <ModelMessage key={turn.key} turn={turn} model="model" active />
            ) : null,
          )}
        </TranscriptTurnsContext>
      </MemoryRouter>
    );
  }
  const view = render(<RealView snapshot={empty} />);
  fireEvent.click(screen.getByRole("button", { name: "Thinking…" }));
  fireEvent.click(
    within(screen.getByRole("list", { name: "Steps" })).getByRole("button", { name: "Thinking…" }),
  );
  const messages = [
    { role: "user", content: "question" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call", type: "function", function: { name: "glob", arguments: "{}" } }],
    },
    { role: "tool", content: "done", tool_call_id: "call" },
  ];
  const proven = {
    ...base,
    messages,
    message_created_at: [null, null, null],
    message_page: { start: 0, end: 3, total: 3, has_older: false },
    committed_prompt: { run_id: "run-a", canonical_index: 0 },
  } as unknown as SessionSnapshotResponse;
  view.rerender(<RealView snapshot={proven} />);
  expect(store.getRuntimeState().optimisticPromptToken).toBeNull();
  expect(
    screen.getByRole("button", { name: /Thinking… · Searched the code/, expanded: true }),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("list", { name: "Steps" })).getByText("Live thought"),
  ).toBeTruthy();
});
