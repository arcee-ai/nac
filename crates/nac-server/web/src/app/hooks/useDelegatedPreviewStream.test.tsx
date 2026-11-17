/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantStreamDelta, SessionEventEnvelope } from "@/app/types/api";
import { useDelegatedPreviewStream } from "./useDelegatedPreviewStream";
import { queryKeys } from "@/app/services/queries";
import { snapshot } from "@/app/features/insights/model/fixtures.test-support";

const subscriptions = vi.hoisted(
  () =>
    new Map<
      string,
      {
        onEnvelope: (event: SessionEventEnvelope) => void;
        onAssistantDelta: (delta: AssistantStreamDelta) => void;
        onReplayGap: () => void;
        onSequenceGap: () => void;
      }
    >(),
);
vi.mock("@/app/runtime/RuntimeContext", () => ({
  useNativeRuntime: () => ({
    events: (
      id: string,
      handlers: {
        onEnvelope: (event: SessionEventEnvelope) => void;
        onAssistantDelta: (delta: AssistantStreamDelta) => void;
        onReplayGap: () => void;
        onSequenceGap: () => void;
      },
    ) => {
      subscriptions.set(id, handlers);
      return () => subscriptions.delete(id);
    },
  }),
}));

afterEach(() => {
  subscriptions.clear();
  vi.unstubAllGlobals();
});

it("recognizes a later run without envelope run ids after a gap", () => {
  vi.stubGlobal("EventSource", class {});
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useDelegatedPreviewStream("child"), { wrapper });
  const handlers = subscriptions.get("child")!;
  act(() =>
    handlers.onEnvelope({
      event: { type: "run_started", started_at_epoch_ms: 42 },
    } as SessionEventEnvelope),
  );
  act(() => handlers.onSequenceGap());
  act(() =>
    handlers.onEnvelope({
      event: { type: "run_started", started_at_epoch_ms: 42 },
    } as SessionEventEnvelope),
  );
  expect(hook.result.current.recovering).toBe(true);
  act(() =>
    handlers.onEnvelope({
      event: { type: "run_started", started_at_epoch_ms: 43 },
    } as SessionEventEnvelope),
  );
  expect(hook.result.current).toMatchObject({ recovering: false, running: true, startedAt: 43 });
  hook.unmount();
  client.clear();
});

it.each([
  [false, false, "replay"],
  [false, true, "replay"],
  [true, false, "replay"],
  [true, true, "replay"],
  [false, false, "sequence"],
  [false, true, "sequence"],
  [true, false, "sequence"],
  [true, true, "sequence"],
] as const)(
  "quarantines a gap with cached snapshot %s, terminal delivered %s and %s gap",
  (cached, terminalDelivered, gap) => {
    vi.stubGlobal("EventSource", class {});
    const client = new QueryClient();
    if (cached)
      client.setQueryData(
        queryKeys.sessionSnapshot("child"),
        snapshot([{ role: "user", content: "Earlier" }]),
      );
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useDelegatedPreviewStream("child"), { wrapper });
    const handlers = subscriptions.get("child")!;
    act(() =>
      handlers.onEnvelope({
        run_id: "run",
        event: { type: "run_started", started_at_epoch_ms: 42 },
      } as SessionEventEnvelope),
    );
    act(() =>
      handlers.onAssistantDelta({
        text: "Same answer",
        reasoning: "Live thoughts",
      } as AssistantStreamDelta),
    );
    act(() => (gap === "replay" ? handlers.onReplayGap() : handlers.onSequenceGap()));
    expect(hook.result.current).toMatchObject({
      recovering: true,
      text: "",
      reasoning: "",
      running: false,
    });
    act(() => handlers.onAssistantDelta({ text: "Same answer" } as AssistantStreamDelta));
    if (terminalDelivered)
      act(() =>
        handlers.onEnvelope({
          run_id: "run",
          event: { type: "run_completed", response: "Same answer" },
        } as SessionEventEnvelope),
      );
    expect(hook.result.current).toMatchObject({ recovering: true, text: "", reasoning: "" });
    // Replay of the same run cannot reintroduce an overlay; a later run can.
    act(() =>
      handlers.onEnvelope({
        run_id: "run",
        event: { type: "run_started", started_at_epoch_ms: 42 },
      } as SessionEventEnvelope),
    );
    expect(hook.result.current.recovering).toBe(true);
    act(() =>
      handlers.onEnvelope({
        run_id: "next",
        event: { type: "run_started", started_at_epoch_ms: 43 },
      } as SessionEventEnvelope),
    );
    expect(hook.result.current).toMatchObject({ recovering: false, running: true, runId: "next" });
    hook.unmount();
    client.clear();
  },
);

it("keeps child tool lifecycle events isolated across switches and ignores worker events", () => {
  vi.stubGlobal("EventSource", class {});
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ id }) => useDelegatedPreviewStream(id), {
    initialProps: { id: "child-a" },
    wrapper,
  });
  const emit = (id: string, event: object) =>
    act(() =>
      subscriptions
        .get(id)
        ?.onEnvelope({ event: { type: "agent", event } } as SessionEventEnvelope),
    );
  emit("child-a", {
    type: "tool_call_started",
    call_id: "call",
    name: "shell",
    args_preview: "ls",
  });
  emit("child-a", {
    type: "tool_call_finished",
    call_id: "call",
    name: "shell",
    content_preview: "error",
    is_error: true,
  });
  emit("child-a", {
    type: "tool_call_started",
    call_id: "worker",
    name: "shell",
    args_preview: "",
    thread_name: "worker",
  });
  expect(hook.result.current.toolEvents.map((event) => event.type)).toEqual([
    "tool_call_started",
    "tool_call_finished",
  ]);
  act(() =>
    subscriptions
      .get("child-a")
      ?.onEnvelope({ event: { type: "transcript_appended" } } as SessionEventEnvelope),
  );
  act(() =>
    subscriptions.get("child-a")?.onAssistantDelta({ text: "Next" } as AssistantStreamDelta),
  );
  expect(hook.result.current.toolEvents).toHaveLength(2);
  hook.rerender({ id: "child-b" });
  expect(hook.result.current.toolEvents).toEqual([]);
  expect(subscriptions.has("child-a")).toBe(false);
  emit("child-b", { type: "tool_call_started", call_id: "other", name: "read", args_preview: "" });
  expect(hook.result.current.toolEvents).toHaveLength(1);
  hook.unmount();
  client.clear();
});

it("retains supplied reasoning at completion until the canonical answer lands", () => {
  vi.stubGlobal("EventSource", class {});
  const client = new QueryClient();
  client.setQueryData(
    queryKeys.sessionSnapshot("child"),
    snapshot([{ role: "user", content: "Earlier" }]),
  );
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useDelegatedPreviewStream("child"), { wrapper });
  act(() =>
    subscriptions.get("child")?.onEnvelope({
      run_id: "run",
      event: { type: "run_started", started_at_epoch_ms: 42 },
    } as SessionEventEnvelope),
  );
  act(() =>
    subscriptions.get("child")?.onAssistantDelta({
      reasoning: "Checking permissions",
      text: "Result",
    } as AssistantStreamDelta),
  );
  expect(hook.result.current).toMatchObject({
    reasoning: "Checking permissions",
    running: true,
    settled: false,
    startedAt: 42,
    baselineEnd: 1,
    runId: "run",
  });
  act(() =>
    subscriptions.get("child")?.onEnvelope({
      run_id: "other",
      event: { type: "transcript_appended", transcript_len: 2 },
    } as SessionEventEnvelope),
  );
  expect(hook.result.current.promptEnd).toBeNull();
  act(() =>
    subscriptions.get("child")?.onEnvelope({
      run_id: "run",
      event: { type: "transcript_appended", transcript_len: 2 },
    } as SessionEventEnvelope),
  );
  expect(hook.result.current.promptEnd).toBe(2);
  act(() =>
    subscriptions.get("child")?.onEnvelope({
      event: { type: "run_completed", response: "Result" },
    } as SessionEventEnvelope),
  );
  expect(hook.result.current).toMatchObject({
    reasoning: "Checking permissions",
    text: "Result",
    running: false,
    settled: true,
  });
  act(() =>
    subscriptions
      .get("child")
      ?.onEnvelope({ event: { type: "run_started" } } as SessionEventEnvelope),
  );
  expect(hook.result.current).toMatchObject({
    reasoning: "",
    text: "",
    running: true,
    settled: false,
  });
  hook.unmount();
  client.clear();
});
