/** @vitest-environment jsdom */
import { act, render, screen, fireEvent, renderHook, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnconfirmedPromptRecovery } from "@/app/components/inspector/transcript/UnconfirmedPromptNotice";
import { useTranscriptModel } from "@/app/components/inspector/transcript/useTranscriptModel";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import { api } from "@/app/services/api";
import type { Message, SessionSnapshotResponse } from "@/app/types/api";
import goalFixture from "../../../../../../../../fixtures/goal-continuation-format.json";

vi.mock("@/app/services/queries", () => ({
  useSessionPermissions: () => ({ data: undefined }),
  queryKeys: { sessionSnapshot: (id: string) => [id] },
}));
vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));

const store = standaloneRuntime.stores.runtimeStore;
function snapshot(messages: Message[], active = false): SessionSnapshotResponse {
  return {
    metadata: { session_id: "s", behavior: "direct" },
    messages,
    message_created_at: messages.map(() => null),
    message_page: {
      start: 0,
      end: messages.length,
      total: messages.length,
      has_older: false,
    },
    response_timing: { response_durations_ms: [] },
    active_run: active
      ? {
          status: "running",
          started_at_epoch_ms: 100,
          submitted_user_message: {
            content: "new question",
            run_id: "run-new",
          },
        }
      : null,
  } as unknown as SessionSnapshotResponse;
}
afterEach(cleanup);
describe("transcript stream attribution", () => {
  it("does not show the previous answer under a new persisted prompt before run_started", () => {
    store.resetRuntime("s");
    store.applyAssistantDelta({ reasoning: "old reasoning" });
    store.applyEnvelope({
      sequence_id: 1,
      event: { type: "run_completed", response: "old answer" },
    } as never);
    const oldMessages: Message[] = [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
    ];
    const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
      initialProps: { snap: snapshot(oldMessages) },
    });
    act(() => {
      const token = store.setOptimisticUserPrompt("new question")!;
      store.bindOptimisticPrompt(token, "run-new");
    });
    expect(hook.result.current.turns.at(-1)?.kind).toBe("user");
    const incoming = {
      ...snapshot([...oldMessages, { role: "user", content: "new question" }], true),
      committed_prompt: { run_id: "run-new", canonical_index: 2 },
    };
    hook.rerender({ snap: incoming });
    act(() => store.syncRunFromSnapshot(incoming.active_run));
    expect(store.getRuntimeState()).toMatchObject({
      running: true,
      streamSettled: true,
      streamPredatesPrompt: true,
    });
    expect(hook.result.current.showPending).toBe(false);
    expect(hook.result.current.turns.at(-1)?.kind).toBe("user");
    // Transcript retires the optimistic copy once this snapshot owns it.
    act(() => store.setOptimisticUserPrompt(null, "committed"));
    expect(store.getRuntimeState().streamPredatesPrompt).toBe(true);
    expect(hook.result.current.turns.at(-1)?.kind).toBe("user");
    act(() => {
      store.applyEnvelope({
        sequence_id: 2,
        event: { type: "run_started", started_at_epoch_ms: 100 },
      } as never);
      store.applyAssistantDelta({
        text: "new answer",
        reasoning: "new reasoning",
      });
    });
    expect(hook.result.current.turns.at(-1)).toMatchObject({
      kind: "model",
      key: "model-3",
      blocks: [{ text: "new reasoning" }, { text: "new answer" }],
    });
  });
  it.each([true, false])(
    "restores prior replies after a rejected send (previous answer stored: %s)",
    (stored) => {
      store.resetRuntime("s");
      store.applyAssistantDelta({ reasoning: "second reasoning" });
      store.applyEnvelope({
        sequence_id: 1,
        event: { type: "run_completed", response: "second answer" },
      } as never);
      const messages: Message[] = [
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second question" },
        ...(stored ? [{ role: "assistant", content: "second answer" } as Message] : []),
      ];
      const snap = snapshot(messages);
      const hook = renderHook(() => useTranscriptModel("s", snap));
      const before = hook.result.current.turns;
      act(() => store.setOptimisticUserPrompt("third question"));
      act(() => store.setOptimisticUserPrompt(null));
      expect(hook.result.current.turns).toEqual(before);
      expect(store.getRuntimeState().streamPredatesPrompt).toBe(false);
    },
  );
  it("removes a rejected first prompt without opening an answer", () => {
    store.resetRuntime("s");
    const snap = snapshot([]);
    const hook = renderHook(() => useTranscriptModel("s", snap));
    act(() => store.setOptimisticUserPrompt("first question"));
    expect(hook.result.current.turns).toMatchObject([{ kind: "user", text: "first question" }]);
    act(() => store.setOptimisticUserPrompt(null));
    expect(hook.result.current.turns).toEqual([]);
  });
  it("a quick new answer stays below its uncommitted prompt", () => {
    store.resetRuntime("s");
    const previous = snapshot([
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
    ]);
    const hook = renderHook(() => useTranscriptModel("s", previous));
    act(() => {
      store.setOptimisticUserPrompt("new question");
      store.applyEnvelope({
        sequence_id: 2,
        event: { type: "run_started", started_at_epoch_ms: 100 },
      } as never);
      store.applyAssistantDelta({
        reasoning: "new reasoning",
        text: "new answer",
      });
      store.applyEnvelope({
        sequence_id: 3,
        event: { type: "run_completed", response: "new answer" },
      } as never);
    });
    expect(hook.result.current.turns.at(-2)).toMatchObject({
      kind: "user",
      text: "new question",
      pending: true,
    });
    expect(hook.result.current.turns.at(-1)).toMatchObject({
      kind: "model",
      key: expect.stringContaining("pending-reply"),
      blocks: [
        { kind: "thoughts", text: "new reasoning", streaming: false },
        { kind: "text", text: "new answer" },
      ],
    });
    expect(hook.result.current.turns.map((turn) => turn.key)).toEqual([
      "user-0",
      "model-1",
      "user-2",
      expect.stringContaining("pending-reply"),
    ]);
  });
  it("keeps prior reasoning with its original turn until the answer is stored", () => {
    store.resetRuntime("s");
    store.applyAssistantDelta({ reasoning: "old reasoning" });
    store.applyEnvelope({
      sequence_id: 1,
      event: { type: "run_completed", response: "old answer" },
    } as never);
    const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
      initialProps: {
        snap: snapshot([{ role: "user", content: "old question" }]),
      },
    });
    act(() => store.setOptimisticUserPrompt("new question"));
    expect(hook.result.current.turns.at(-2)).toMatchObject({
      kind: "model",
      key: "model-1",
      blocks: [
        { kind: "thoughts", text: "old reasoning", streaming: false },
        { kind: "text", text: "old answer" },
      ],
    });
    act(() =>
      store.bindOptimisticPrompt(store.getRuntimeState().optimisticPromptToken!, "run-new"),
    );
    hook.rerender({
      snap: {
        ...snapshot(
          [
            { role: "user", content: "old question" },
            { role: "assistant", content: "old answer" },
            { role: "user", content: "new question" },
          ],
          true,
        ),
        committed_prompt: { run_id: "run-new", canonical_index: 2 },
      },
    });
    expect(hook.result.current.turns.map((turn) => turn.key)).toEqual([
      "user-0",
      "model-1",
      "user-2",
    ]);
    expect(hook.result.current.turns[1]).toMatchObject({
      kind: "model",
      blocks: [{ kind: "text", text: "old answer" }],
    });
  });
});

it("reconciles a completed question continuation by exact accepted prompt receipt", () => {
  store.resetRuntime("s");
  const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
    initialProps: { snap: snapshot([]) },
  });
  act(() => {
    const token = store.setOptimisticUserPrompt("question")!;
    store.bindOptimisticPrompt(token, "run-a");
    store.applyEnvelope({
      sequence_id: 1,
      event: { type: "run_started", started_at_epoch_ms: 1 },
    } as never);
    store.applyAssistantDelta({ text: "answer" });
    store.applyEnvelope({
      sequence_id: 2,
      event: { type: "run_completed", response: "answer" },
    } as never);
  });
  const messages: Message[] = [
    { role: "user", content: "question" },
    { role: "assistant", content: null },
    { role: "user", content: "Structured question response" },
    { role: "assistant", content: "answer" },
  ];
  hook.rerender({
    snap: {
      ...snapshot(messages),
      committed_prompt: { run_id: "run-a", canonical_index: 0 },
    },
  });
  expect(hook.result.current.showPending).toBe(false);
  expect(
    hook.result.current.turns.flatMap((turn) =>
      turn.kind === "model"
        ? turn.blocks.filter((block) => block.kind === "text" && block.text === "answer")
        : [],
    ),
  ).toHaveLength(1);
});

it("does not infer a repeated prompt from identical text or a foreign run proof", () => {
  store.resetRuntime("s");
  const messages: Message[] = [
    { role: "user", content: "repeat" },
    { role: "assistant", content: "old" },
  ];
  const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
    initialProps: { snap: snapshot(messages) },
  });
  act(() => {
    const token = store.setOptimisticUserPrompt("repeat")!;
    store.bindOptimisticPrompt(token, "run-b");
  });
  hook.rerender({
    snap: {
      ...snapshot(messages),
      committed_prompt: { run_id: "run-a", canonical_index: 0 },
    },
  });
  expect(hook.result.current.showPending).toBe(true);
  hook.rerender({
    snap: {
      ...snapshot([...messages, { role: "user", content: "repeat" }]),
      committed_prompt: { run_id: "run-b", canonical_index: 2 },
    },
  });
  expect(hook.result.current.showPending).toBe(false);
});

it("does not retire while the snapshot predates proof, but accepts an out-of-window committed prompt", () => {
  store.resetRuntime("s");
  const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
    initialProps: { snap: snapshot([]) },
  });
  act(() => {
    const token = store.setOptimisticUserPrompt("question")!;
    store.bindOptimisticPrompt(token, "run-a");
  });
  hook.rerender({
    snap: {
      ...snapshot([]),
      committed_prompt: { run_id: "run-a", canonical_index: 1 },
    },
  });
  expect(hook.result.current.showPending).toBe(true);
  const window = snapshot([{ role: "user", content: "later" }]);
  window.message_page = { start: 2, end: 3, total: 3, has_older: true };
  hook.rerender({
    snap: {
      ...window,
      committed_prompt: { run_id: "run-a", canonical_index: 1 },
    },
  });
  expect(hook.result.current.showPending).toBe(false);
});

it("a stale effect for an earlier prompt cannot retire a later identical submission", () => {
  store.resetRuntime("s");
  let first = 0;
  act(() => {
    first = store.setOptimisticUserPrompt("same")!;
    store.bindOptimisticPrompt(first, "a");
  });
  act(() => {
    const second = store.setOptimisticUserPrompt("same")!;
    store.bindOptimisticPrompt(second, "b");
  });
  act(() => store.retireOptimisticPrompt(first));
  expect(store.getRuntimeState()).toMatchObject({
    optimisticUserPrompt: "same",
    optimisticPromptRunId: "b",
  });
});

it("active remote repeated text stays pending until its own receipt appears", () => {
  store.resetRuntime("s");
  const old: Message[] = [
    { role: "user", content: "new question" },
    { role: "assistant", content: "old answer" },
  ];
  const incoming = snapshot(old, true);
  const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
    initialProps: { snap: incoming },
  });
  act(() => store.syncRunFromSnapshot(incoming.active_run));
  expect(hook.result.current.showPending).toBe(true);
  const current = {
    ...snapshot([...old, { role: "user", content: "new question" }], true),
    committed_prompt: { run_id: "run-new", canonical_index: 2 },
  };
  hook.rerender({ snap: current });
  expect(hook.result.current.showPending).toBe(false);
});

it("dismisses only the explicitly chosen unresolved submission without replay", () => {
  store.resetRuntime("s");
  let old = 0;
  act(() => {
    old = store.setOptimisticUserPrompt("old")!;
    store.markOptimisticPromptUncertain(old);
  });
  act(() => {
    const current = store.setOptimisticUserPrompt("new")!;
    store.bindOptimisticPrompt(current, "new-run");
  });
  act(() => store.dismissOptimisticPrompt(old));
  expect(store.getRuntimeState()).toMatchObject({
    optimisticUserPrompt: "new",
    optimisticPromptRunId: "new-run",
  });
  const current = store.getRuntimeState().optimisticPromptToken!;
  act(() => store.dismissOptimisticPrompt(current));
  expect(store.getRuntimeState().optimisticUserPrompt).toBeNull();
  act(() => store.bindOptimisticPrompt(current, "late"));
  expect(store.getRuntimeState().optimisticPromptRunId).toBeNull();
});

it("hides only the dismissed accepted run's stale active fallback during disconnect", () => {
  store.resetRuntime("s");
  const stale = snapshot([], true);
  let token = 0;
  act(() => {
    token = store.setOptimisticUserPrompt("new question")!;
    store.bindOptimisticPrompt(token, "run-new");
    store.syncRunFromSnapshot(stale.active_run);
    store.setStreamStatus("error");
  });
  const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
    initialProps: { snap: stale },
  });
  expect(hook.result.current.showPending).toBe(true);
  act(() => store.dismissOptimisticPrompt(token));
  expect(hook.result.current.showPending).toBe(false);
  act(() => {
    store.setOptimisticUserPrompt("new attempt");
    store.setOptimisticUserPrompt(null);
  });
  expect(hook.result.current.showPending).toBe(false);
  act(() => {
    const uncertain = store.setOptimisticUserPrompt("unknown attempt")!;
    store.markOptimisticPromptUncertain(uncertain);
    store.dismissOptimisticPrompt(uncertain);
  });
  expect(hook.result.current.showPending).toBe(false);
  act(() => {
    const accepted = store.setOptimisticUserPrompt("second accepted")!;
    store.bindOptimisticPrompt(accepted, "second-run");
    store.dismissOptimisticPrompt(accepted);
  });
  expect(hook.result.current.showPending).toBe(false);
  const other = snapshot([], true);
  other.active_run!.submitted_user_message!.run_id = "different-run";
  hook.rerender({ snap: other });
  expect(hook.result.current.showPending).toBe(true);
  act(() => store.resetRuntime("different-session"));
  expect(store.getRuntimeState().dismissedPromptRunIds).toEqual([]);
});

it("offers explicit recovery when an accepted prompt has no proof", () => {
  vi.useFakeTimers();
  const submit = vi.spyOn(api, "submitRun");
  try {
    store.resetRuntime("s");
    let token = 0;
    act(() => {
      token = store.setOptimisticUserPrompt("reverted prompt")!;
      store.bindOptimisticPrompt(token, "old-run");
      store.setStreamStatus("error");
    });
    const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
      initialProps: { snap: snapshot([]) },
    });
    expect(hook.result.current.showPending).toBe(true);
    render(
      <UnconfirmedPromptRecovery
        sessionId="s"
        token={token}
        showPending={hook.result.current.showPending}
        running={false}
      />,
    );
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByRole("button", { name: "Hide unconfirmed message" }));
    expect(store.getRuntimeState().optimisticUserPrompt).toBeNull();
    expect(hook.result.current.showPending).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  } finally {
    submit.mockRestore();
    vi.useRealTimers();
  }
});

it("keeps a live reply identity when its accepted prompt becomes proven", () => {
  store.resetRuntime("s");
  const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
    initialProps: { snap: snapshot([]) },
  });
  act(() => {
    const token = store.setOptimisticUserPrompt("question")!;
    store.bindOptimisticPrompt(token, "run-a");
    store.applyEnvelope({
      sequence_id: 1,
      run_id: "run-a",
      event: { type: "run_started", started_at_epoch_ms: 1 },
    } as never);
    store.applyAssistantDelta({ reasoning: "thinking", run_id: "run-a" });
  });
  const messages: Message[] = [
    { role: "user", content: "question" },
    { role: "assistant", content: null },
  ];
  hook.rerender({ snap: snapshot(messages, true) });
  const before = hook.result.current.turns.at(-1)?.key;
  hook.rerender({
    snap: {
      ...snapshot(messages, true),
      committed_prompt: { run_id: "run-a", canonical_index: 0 },
    },
  });
  expect(hook.result.current.turns.at(-1)?.key).toBe(before);
});

it.each([
  "missing delta identity",
  "foreign delta",
  "foreign reset",
  "foreign start",
  "reconnect",
  "rewind",
])("does not transfer a live reply across %s", (interrupt) => {
  store.resetRuntime("s");
  const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
    initialProps: { snap: snapshot([]) },
  });
  act(() => {
    const token = store.setOptimisticUserPrompt("question")!;
    store.bindOptimisticPrompt(token, "run-a");
    store.applyEnvelope({
      sequence_id: 1,
      run_id: "run-a",
      event: { type: "run_started", started_at_epoch_ms: 1 },
    } as never);
    store.applyAssistantDelta({ reasoning: "thinking", run_id: "run-a" });
    if (interrupt === "missing delta identity") store.applyAssistantDelta({ reasoning: "more" });
    if (interrupt === "foreign delta")
      store.applyAssistantDelta({ reasoning: "more", run_id: "run-b" });
    if (interrupt === "foreign reset") store.applyAssistantDelta({ reset: true, run_id: "run-b" });
    if (interrupt === "foreign start")
      store.applyEnvelope({
        sequence_id: 2,
        run_id: "run-b",
        event: { type: "run_started", started_at_epoch_ms: 2 },
      } as never);
    if (interrupt === "reconnect") {
      store.setStreamStatus("live");
      store.setStreamStatus("reconnecting");
    }
    if (interrupt === "rewind")
      store.applyEnvelope({
        sequence_id: 2,
        event: { type: "transcript_reverted" },
      } as never);
    // A late old-run delta must not undo the interruption fence.
    store.applyAssistantDelta({ reasoning: "late", run_id: "run-a" });
  });
  const messages: Message[] = [
    { role: "user", content: "question" },
    { role: "assistant", content: null },
  ];
  hook.rerender({ snap: snapshot(messages, true) });
  const before = hook.result.current.turns.at(-1)?.key;
  hook.rerender({
    snap: {
      ...snapshot(messages, true),
      committed_prompt: { run_id: "run-a", canonical_index: 0 },
    },
  });
  expect(hook.result.current.turns.at(-1)?.key).not.toBe(before);
});

it("does not carry a reply identity past an intervening goal continuation", () => {
  store.resetRuntime("s");
  const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
    initialProps: { snap: snapshot([]) },
  });
  act(() => {
    const token = store.setOptimisticUserPrompt("question")!;
    store.bindOptimisticPrompt(token, "run-a");
    store.applyEnvelope({
      sequence_id: 1,
      run_id: "run-a",
      event: { type: "run_started", started_at_epoch_ms: 1 },
    } as never);
    store.applyAssistantDelta({ reasoning: "thinking", run_id: "run-a" });
  });
  const before = hook.result.current.turns.at(-1)?.key;
  const messages: Message[] = [
    { role: "user", content: "question" },
    {
      role: "user",
      content: goalFixture.vectors[0].message,
    },
  ];
  hook.rerender({
    snap: {
      ...snapshot(messages, true),
      committed_prompt: { run_id: "run-a", canonical_index: 0 },
    },
  });
  expect(hook.result.current.turns.some((turn) => turn.kind === "goal-continuation")).toBe(true);
  expect(hook.result.current.turns.at(-1)?.key).not.toBe(before);
});

it("does not revive a proven reply identity after a later submission is rejected between renders", () => {
  store.resetRuntime("s");
  const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
    initialProps: { snap: snapshot([]) },
  });
  let first = 0;
  act(() => {
    first = store.setOptimisticUserPrompt("question")!;
    store.bindOptimisticPrompt(first, "run-a");
    store.applyEnvelope({
      sequence_id: 1,
      run_id: "run-a",
      event: { type: "run_started", started_at_epoch_ms: 1 },
    } as never);
    store.applyAssistantDelta({ reasoning: "thinking", run_id: "run-a" });
  });
  const before = hook.result.current.turns.at(-1)?.key;
  const proven = {
    ...snapshot([
      { role: "user", content: "question" },
      { role: "assistant", content: null },
    ]),
    committed_prompt: { run_id: "run-a", canonical_index: 0 },
  };
  hook.rerender({ snap: proven });
  expect(hook.result.current.turns.at(-1)?.key).toBe(before);
  act(() => store.retireOptimisticPrompt(first));
  act(() => {
    store.setOptimisticUserPrompt("next");
    store.setOptimisticUserPrompt(null);
  });
  expect(hook.result.current.turns.at(-1)?.key).not.toBe(before);
});

it("preserves a reply when exact matching start and delta precede acceptance", () => {
  store.resetRuntime("s");
  const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
    initialProps: { snap: snapshot([]) },
  });
  let token = 0;
  act(() => {
    token = store.setOptimisticUserPrompt("question")!;
  });
  act(() => {
    store.applyEnvelope({
      sequence_id: 1,
      run_id: "run-a",
      event: { type: "run_started", started_at_epoch_ms: 1 },
    } as never);
    store.applyAssistantDelta({ run_id: "run-a", reasoning: "thinking" });
    store.bindOptimisticPrompt(token, "run-a");
  });
  const before = hook.result.current.turns.at(-1)?.key;
  hook.rerender({
    snap: {
      ...snapshot([
        { role: "user", content: "question" },
        { role: "assistant", content: null },
      ]),
      committed_prompt: { run_id: "run-a", canonical_index: 0 },
    },
  });
  expect(hook.result.current.turns.at(-1)?.key).toBe(before);
});

it.each([
  "missing",
  "mixed",
  "foreign",
  "reconnect",
  "rewind",
  "foreign failure",
  "unknown cancellation",
])("rejects %s pre-acceptance observations", (kind) => {
  store.resetRuntime("s");
  const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
    initialProps: { snap: snapshot([]) },
  });
  let token = 0;
  act(() => {
    token = store.setOptimisticUserPrompt("question")!;
  });
  act(() => {
    store.applyEnvelope({
      sequence_id: 1,
      run_id: "run-a",
      event: { type: "run_started", started_at_epoch_ms: 1 },
    } as never);
    store.applyAssistantDelta({ run_id: "run-a", reasoning: "thinking" });
    if (kind === "missing") store.applyAssistantDelta({ reasoning: "more" });
    if (kind === "mixed") store.applyAssistantDelta({ run_id: "run-b", reasoning: "more" });
    if (kind === "reconnect") {
      store.setStreamStatus("live");
      store.setStreamStatus("reconnecting");
    }
    if (kind === "rewind")
      store.applyEnvelope({ sequence_id: 2, event: { type: "transcript_reverted" } } as never);
    if (kind === "foreign failure")
      store.applyEnvelope({
        sequence_id: 2,
        run_id: "run-b",
        event: { type: "run_failed", message: "failed" },
      } as never);
    if (kind === "unknown cancellation")
      store.applyEnvelope({ sequence_id: 2, event: { type: "run_cancelled" } } as never);
    store.bindOptimisticPrompt(token, kind === "foreign" ? "run-b" : "run-a");
  });
  const before = hook.result.current.turns.at(-1)?.key;
  hook.rerender({
    snap: {
      ...snapshot([
        { role: "user", content: "question" },
        { role: "assistant", content: null },
      ]),
      committed_prompt: { run_id: kind === "foreign" ? "run-b" : "run-a", canonical_index: 0 },
    },
  });
  expect(hook.result.current.turns.at(-1)?.key).not.toBe(before);
});

it("does not bind an old accepted response to a newer token", () => {
  store.resetRuntime("s");
  const first = store.setOptimisticUserPrompt("first")!;
  store.applyAssistantDelta({ run_id: "run-a", reasoning: "old" });
  const second = store.setOptimisticUserPrompt("second")!;
  store.applyAssistantDelta({ run_id: "run-b", reasoning: "new" });
  const before = store.getRuntimeState();
  store.bindOptimisticPrompt(first, "run-a");
  expect(store.getRuntimeState()).toMatchObject({
    optimisticPromptToken: second,
    optimisticPromptRunId: null,
    optimisticObservedRunId: "run-b",
    streamIdentityEpoch: before.streamIdentityEpoch,
  });
});

it("does not infer admission from matching unbound events and receipt", () => {
  store.resetRuntime("s");
  const hook = renderHook(({ snap }) => useTranscriptModel("s", snap), {
    initialProps: { snap: snapshot([]) },
  });
  act(() => {
    const token = store.setOptimisticUserPrompt("question")!;
    store.applyAssistantDelta({ run_id: "run-a", reasoning: "thinking" });
    store.markOptimisticPromptUncertain(token);
  });
  hook.rerender({
    snap: {
      ...snapshot([{ role: "user", content: "question" }]),
      committed_prompt: { run_id: "run-a", canonical_index: 0 },
    },
  });
  expect(hook.result.current.showPending).toBe(true);
  expect(store.getRuntimeState().optimisticPromptRunId).toBeNull();
});
