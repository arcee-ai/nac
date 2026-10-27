/** @vitest-environment jsdom */
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTranscriptModel } from "@/app/components/inspector/transcript/useTranscriptModel";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import type { Message, SessionSnapshotResponse } from "@/app/types/api";

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
    message_page: { start: 0, end: messages.length, total: messages.length, has_older: false },
    response_timing: { response_durations_ms: [] },
    threads: [],
    active_threads: [],
    thread_events: {},
    worksets: { items: [] },
    active_run: active
      ? {
          status: "running",
          started_at_epoch_ms: 100,
          submitted_user_message: { content: "new question" },
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
    act(() => store.setOptimisticUserPrompt("new question"));
    expect(hook.result.current.turns.at(-1)?.kind).toBe("user");
    const incoming = snapshot([...oldMessages, { role: "user", content: "new question" }], true);
    hook.rerender({ snap: incoming });
    act(() => store.syncRunFromSnapshot(incoming.active_run));
    expect(store.getRuntimeState()).toMatchObject({
      running: true,
      streamSettled: true,
      streamPredatesPrompt: true,
    });
    expect(hook.result.current.showPending).toBe(false);
    expect(hook.result.current.turns.at(-1)?.kind).toBe("user");
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
      store.applyAssistantDelta({ reasoning: "new reasoning", text: "new answer" });
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
      key: "model-3",
      blocks: [
        { kind: "thoughts", text: "new reasoning", streaming: false },
        { kind: "text", text: "new answer" },
      ],
    });
    expect(hook.result.current.turns.map((turn) => turn.key)).toEqual([
      "user-0",
      "model-1",
      "user-2",
      "model-3",
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
      initialProps: { snap: snapshot([{ role: "user", content: "old question" }]) },
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
    hook.rerender({
      snap: snapshot(
        [
          { role: "user", content: "old question" },
          { role: "assistant", content: "old answer" },
          { role: "user", content: "new question" },
        ],
        true,
      ),
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
