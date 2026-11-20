// Live run state for the currently viewed session, driven by the SSE stream.
// This tracks a running flag, a human-readable activity line, an error, the
// usage the current run has accrued and a capped event log feeding the Events
// tab and the transcript typing indicator.

import { createStore, standalonePreferenceStorage } from "@/app/lib/store";
import { addTokenUsage, isActiveRun, maxBillableUsage, tokenUsageHasSpend } from "@/app/lib/format";
import { toolCallFailed } from "@/app/lib/toolPresentation";
import type { StreamStatus } from "@/app/services/eventStream";
import type {
  ActiveRunSnapshot,
  AgentEvent,
  AssistantStreamDelta,
  SessionEventEnvelope,
  RunFailure,
  TokenUsage,
} from "@/app/types/api";

export type RuntimeEventKind =
  | "run"
  | "tool"
  | "mcp"
  | "assistant"
  | "steering"
  | "compaction"
  | "error";

export interface RuntimeEvent {
  seq: number | null;
  kind: RuntimeEventKind;
  text: string;
  isError: boolean;
  ts: number;
  local: boolean;
}

export interface RuntimeState {
  sessionId: string | null;
  running: boolean;
  activity: string;
  error: string | null;
  /**
   * The provider's own reason for refusing the current run's model call. The
   * terminal `run_failed` says only "run failed", so this is what turns the red
   * box into something the user can act on.
   */
  modelError: string | null;
  /** Structured terminal failure for recovery-aware transcript actions. */
  runFailure: RunFailure | null;
  /** Model request attempt currently replacing an abandoned partial stream. */
  modelRetryAttempt: number | null;
  streamStatus: StreamStatus;
  events: RuntimeEvent[];
  /** Safe top-level tool lifecycle overlays, merged with durable snapshot rows by call id. */
  primaryToolEvents: AgentEvent[];
  /** Prose the current model call has produced so far. */
  streamText: string;
  /** Reasoning the current model call has produced so far. */
  streamReasoning: string;
  /**
   * The buffers hold output that is already committed, so the next delta starts
   * a new call rather than appending to it. They are kept rather than cleared so
   * the transcript does not blink between the commit and the refetched snapshot;
   * the renderer drops whichever part the snapshot already covers.
   */
  streamSettled: boolean;
  // The buffers hold output from before the prompt sent last, and its run has
  // neither started nor streamed since, so none of that output answers it.
  streamPredatesPrompt: boolean;
  /**
   * Prompt shown in the chat from the moment Send is pressed until the
   * snapshot (or active_run) catches up. Without this the model pill appears
   * first and jumps down when the user bubble finally lands.
   */
  optimisticUserPrompt: string | null;
  /**
   * What the current run has spent so far, summed from the usage events the
   * model calls emit. The snapshot only learns the run's usage once the run
   * ends, so this is the only account of an hour-long run in progress. It is
   * a delta over the snapshot totals, which stay fixed for the whole run.
   */
  runUsage: TokenUsage | null;
  /**
   * Session spend that only rises while this tab is open. Stop must not drop
   * the composer totals back to a zero snapshot; `run_started` only clears
   * the live delta above.
   */
  sessionSpend: TokenUsage | null;
  /**
   * Wall-clock start of the current run, kept after Stop so the composer
   * clock can keep showing elapsed instead of falling back to a previous
   * response's duration (or `--:--`).
   */
  runStartedAt: number | null;
  /** Frozen elapsed ms from the last run, used once live `startedAt` is gone. */
  lastElapsedMs: number | null;
  /**
   * Bumped by every event that could have touched the checkout. The Files panel
   * watches it to reread the diff while a run is still going, instead of
   * standing on whatever the checkout looked like when the panel opened.
   */
  workspaceEpoch: number;
  /**
   * Stop was painted; the HTTP cancel is still waiting for process cleanup.
   * Composer Send and transcript Regenerate stay blocked, and a still-live
   * `active_run` on the snapshot must not snap the chrome back to running.
   */
  cancelArmed: boolean;
}

export type RefreshKind = "none" | "messages" | "snapshot" | "replace-snapshot";
/** One presentation lifetime; hosted preferences are ephemeral. */
export function createRuntimeStore(_storage?: Pick<Storage, "getItem" | "setItem">) {
  const runtimeStore = createStore<RuntimeState>(
    {
      sessionId: null,
      running: false,
      activity: "",
      error: null,
      modelError: null,
      runFailure: null,
      modelRetryAttempt: null,
      streamStatus: "idle",
      events: [],
      primaryToolEvents: [],
      streamText: "",
      streamReasoning: "",
      streamSettled: false,
      streamPredatesPrompt: false,
      optimisticUserPrompt: null,
      runUsage: null,
      sessionSpend: null,
      runStartedAt: null,
      lastElapsedMs: null,
      workspaceEpoch: 0,
      cancelArmed: false,
    },
    "runtime",
  );
  const initial_runtimeStore = runtimeStore.getState();

  const { setState, getState, useStore } = runtimeStore;

  const MAX_EVENTS = 300;

  let runtimeActivation = {};

  /** Capture this presentation activation, including same-session reopen/StrictMode. */
  function captureRuntimeActivation(sessionId: string): () => boolean {
    const activation = runtimeActivation;
    return () => activation === runtimeActivation && getState().sessionId === sessionId;
  }

  function resetRuntime(sessionId: string | null): void {
    runtimeActivation = {};
    setState({
      sessionId,
      running: false,
      activity: "",
      error: null,
      modelError: null,
      runFailure: null,
      modelRetryAttempt: null,
      streamStatus: sessionId ? "connecting" : "idle",
      events: [],
      primaryToolEvents: [],
      streamText: "",
      streamReasoning: "",
      streamSettled: false,
      streamPredatesPrompt: false,
      optimisticUserPrompt: null,
      runUsage: null,
      sessionSpend: null,
      runStartedAt: null,
      lastElapsedMs: null,
      workspaceEpoch: 0,
      cancelArmed: false,
    });
  }

  /** Raise session spend to match a snapshot total; never lowers it. */
  function liftSessionSpend(persisted: TokenUsage | null | undefined): void {
    if (!tokenUsageHasSpend(persisted) || !persisted) return;
    setState((state) => {
      const next = maxBillableUsage(state.sessionSpend, persisted);
      if (
        next?.input_tokens === state.sessionSpend?.input_tokens &&
        next?.output_tokens === state.sessionSpend?.output_tokens &&
        next?.cache_read_tokens === state.sessionSpend?.cache_read_tokens &&
        next?.cache_write_tokens === state.sessionSpend?.cache_write_tokens &&
        (next?.cost?.total ?? 0) === (state.sessionSpend?.cost?.total ?? 0)
      ) {
        return {};
      }
      return { sessionSpend: next };
    });
  }

  /**
   * Paint the prompt immediately on submit. A rejected/unsent prompt takes its
   * stream fence with it; a prompt committed to the transcript keeps the fence
   * until its run starts or streams, even though its optimistic copy can leave.
   */
  function setOptimisticUserPrompt(
    prompt: string | null,
    settlement: "rejected" | "committed" = "rejected",
  ): void {
    if (prompt === null) {
      setState((state) => ({
        optimisticUserPrompt: null,
        streamPredatesPrompt: settlement === "committed" && state.streamPredatesPrompt,
      }));
    } else setState({ optimisticUserPrompt: prompt, streamPredatesPrompt: true });
  }

  /**
   * Fold one slice of the session's live model output into the buffers.
   */
  function applyAssistantDelta(delta: AssistantStreamDelta): void {
    if (delta.reset) {
      setState({
        streamSettled: false,
        streamPredatesPrompt: false,
        streamText: "",
        streamReasoning: "",
        modelRetryAttempt: delta.retry_attempt ?? null,
      });
      return;
    }
    setState((state) => {
      const base = state.streamSettled
        ? { streamText: "", streamReasoning: "" }
        : {
            streamText: state.streamText,
            streamReasoning: state.streamReasoning,
          };
      return {
        streamSettled: false,
        streamPredatesPrompt: false,
        streamText: base.streamText + (delta.text ?? ""),
        streamReasoning: base.streamReasoning + (delta.reasoning ?? ""),
      };
    });
  }

  function setStreamStatus(streamStatus: StreamStatus): void {
    setState({ streamStatus });
  }

  /**
   * Seed the running flag from a snapshot. Without this a reload or reconnect in
   * the middle of a run would show the session as idle until the next event, the
   * way the legacy UI did.
   */
  function syncRunFromSnapshot(activeRun: ActiveRunSnapshot | null | undefined): void {
    const running = isActiveRun(activeRun);
    const state = getState();
    if (state.cancelArmed) {
      // Optimistic cache already dropped `active_run`, so an idle snapshot here
      // does not mean cancel HTTP finished. Keep Stopping until finishRunCancel
      // or a terminal SSE event.
      return;
    }
    const runStartedAt = running && activeRun ? activeRun.started_at_epoch_ms : state.runStartedAt;
    if (state.running === running && state.runStartedAt === runStartedAt) return;
    setState({
      running,
      activity: running ? state.activity : "",
      runStartedAt: running ? runStartedAt : null,
      lastElapsedMs: running ? null : freezeElapsed(state),
    });
  }

  /** Record a client-side event so the Events tab shows the full interaction. */
  function pushLocalEvent(kind: RuntimeEventKind, text: string, isError = false): void {
    pushEvent({ seq: null, kind, text, isError, local: true });
  }

  function pushEvent(event: Omit<RuntimeEvent, "ts" | "local"> & { local?: boolean }) {
    setState((state) => {
      const events =
        state.events.length >= MAX_EVENTS ? state.events.slice(1) : state.events.slice();
      events.push({ ts: Date.now(), local: false, ...event });
      return { events };
    });
  }

  function elapsedSince(startedAt: number | null | undefined): number | null {
    if (startedAt == null || startedAt <= 0) return null;
    return Math.max(0, Date.now() - startedAt);
  }

  function freezeElapsed(
    state: Pick<RuntimeState, "runStartedAt" | "lastElapsedMs">,
    extra?: number | null,
  ): number | null {
    const candidates = [elapsedSince(state.runStartedAt), state.lastElapsedMs, extra].filter(
      (value): value is number => value != null,
    );
    return candidates.length ? Math.max(...candidates) : null;
  }

  /**
   * Paint Stopping immediately. The HTTP cancel still waits for process cleanup;
   * `finishRunCancel` and SSE `run_cancelled` clear the arm without flipping
   * running back on.
   */
  function requestRunCancel(): RuntimeState {
    const previous = getState();
    if (!previous.running) {
      return previous;
    }
    setState((state) => ({
      running: false,
      activity: "",
      error: null,
      modelError: null,
      runFailure: null,
      modelRetryAttempt: null,
      streamSettled: true,
      cancelArmed: true,
      lastElapsedMs: freezeElapsed(state),
      runStartedAt: null,
    }));
    return previous;
  }

  /** Restore the pre-Stop snapshot when the cancel request itself fails. */
  function restoreRunCancel(previous: RuntimeState): void {
    setState({
      running: previous.running,
      activity: previous.activity,
      error: previous.error,
      modelError: previous.modelError,
      runFailure: previous.runFailure,
      modelRetryAttempt: previous.modelRetryAttempt,
      streamSettled: previous.streamSettled,
      cancelArmed: previous.cancelArmed,
      lastElapsedMs: previous.lastElapsedMs,
      runStartedAt: previous.runStartedAt,
    });
  }

  /**
   * Cancel HTTP returned: cleanup is complete, so Send/Regenerate are available again.
   * SSE `run_cancelled` does the same; either may win.
   */
  function finishRunCancel(): void {
    setState((state) => ({
      cancelArmed: false,
      running: false,
      activity: "",
      lastElapsedMs: freezeElapsed(state),
      runStartedAt: null,
    }));
  }

  /**
   * Classify one envelope by the smallest canonical projection it invalidates.
   * Runtime state is updated synchronously before the caller starts that read.
   */
  function applyEnvelope(envelope: SessionEventEnvelope): RefreshKind {
    const seq = envelope.sequence_id;
    const event = envelope.event;
    switch (event.type) {
      case "run_started":
        setState({
          running: true,
          // Keep the chat chrome as a plain live ModelMessage (pill + model);
          // Tool events fill activity once there is something to name.
          activity: "",
          error: null,
          modelError: null,
          runFailure: null,
          modelRetryAttempt: null,
          streamText: "",
          streamReasoning: "",
          streamSettled: false,
          streamPredatesPrompt: false,
          // Only this run's live delta resets. Session spend lives on the
          // snapshot, including unattributed usage from cancelled or rewound turns.
          runUsage: null,
          runStartedAt: event.started_at_epoch_ms,
          lastElapsedMs: null,
          cancelArmed: false,
        });
        pushEvent({
          seq,
          kind: "run",
          text: `Run started: ${event.prompt_preview}`,
          isError: false,
        });
        return "snapshot";
      case "run_completed":
        // The run's own answer is the authoritative version of whatever the
        // stream last held, so it takes over until the snapshot lands; the
        // reasoning behind it stays too, or its group would drop out of both
        // panes until then.
        setState((state) => ({
          running: false,
          activity: "",
          streamText: event.response,
          streamSettled: true,
          runFailure: null,
          modelRetryAttempt: null,
          cancelArmed: false,
          lastElapsedMs: freezeElapsed(state, event.duration_ms ?? null),
          runStartedAt: null,
        }));
        pushEvent({ seq, kind: "run", text: "Run completed", isError: false });
        return "snapshot";
      case "run_failed": {
        // The terminal message is a constant; a provider refusal seen earlier in
        // this run explains the same failure and says something useful.
        const message = getState().modelError ?? event.message;
        setState((state) => ({
          running: false,
          activity: "",
          error: message,
          runFailure: event.failure ?? null,
          modelRetryAttempt: null,
          streamSettled: true,
          cancelArmed: false,
          lastElapsedMs: freezeElapsed(state),
          runStartedAt: null,
        }));
        pushEvent({ seq, kind: "error", text: message, isError: true });
        return "snapshot";
      }
      case "run_cancelled":
        // The transcript carries the cancellation marker, so no error is shown.
        setState((state) => ({
          running: false,
          activity: "",
          error: null,
          modelError: null,
          runFailure: null,
          modelRetryAttempt: null,
          streamSettled: true,
          cancelArmed: false,
          lastElapsedMs: freezeElapsed(state),
          runStartedAt: null,
        }));
        pushEvent({ seq, kind: "run", text: "Run cancelled", isError: false });
        return "snapshot";
      case "snapshot_saved":
        return "snapshot";
      case "transcript_appended":
        // A message was committed, so the buffers now describe the past.
        setState({ streamSettled: true });
        return "messages";
      case "transcript_reverted":
        // The messages the buffers were catching up to no longer exist, so the
        // leftovers would be replayed against a transcript that never had them.
        // Live tool events went with those messages, and a rerun that dispatches
        // the same name again would otherwise inherit the discarded run's log.
        setState({
          streamSettled: true,
          streamText: "",
          streamReasoning: "",
          primaryToolEvents: [],
        });
        return "replace-snapshot";
      case "agent":
        return applyAgent(seq, event.event);
      default:
        return "none";
    }
  }

  function applyAgent(seq: number, event: AgentEvent): RefreshKind {
    switch (event.type) {
      case "tool_call_started":
        pushPrimaryToolEvent(event);
        if (event.delegation_intent || event.delegation_summary_verified) return "none";
        setState({ activity: `Tool: ${event.name}` });
        pushEvent({
          seq,
          kind: "tool",
          text: `▶ ${event.name}(${event.args_preview})`,
          isError: false,
        });
        return "none";
      case "mcp_server_skipped":
        pushEvent({
          seq,
          kind: "mcp",
          text: `MCP ${event.server_name}: ${event.reason}`,
          isError: true,
        });
        return "none";
      case "mcp_notification":
        pushEvent({
          seq,
          kind: "mcp",
          text: `MCP ${event.server_name}: ${event.message}`,
          isError: event.kind === "catalog_refresh_failed",
        });
        return "none";
      case "tool_call_finished": {
        const failed = toolCallFailed(event);
        pushPrimaryToolEvent(event);
        pushEvent({
          seq,
          kind: "tool",
          text: `${failed ? "✕" : "✓"} ${event.name}: ${event.content_preview}`,
          isError: failed,
        });
        setState((state) => ({ workspaceEpoch: state.workspaceEpoch + 1 }));
        return "none";
      }
      case "token_usage_updated":
        setState((state) => ({
          runUsage: addTokenUsage(state.runUsage, event.usage, event.usage.total_tokens),
          sessionSpend: addTokenUsage(
            state.sessionSpend,
            event.usage,
            event.usage.total_tokens || (state.sessionSpend?.total_tokens ?? 0),
          ),
        }));
        return "none";
      case "assistant_message":
        setState({ activity: "" });
        pushEvent({
          seq,
          kind: "assistant",
          text: "New assistant message",
          isError: false,
        });
        return "none";
      case "compaction_started":
        setState({ activity: "Compacting context…" });
        pushEvent({
          seq,
          kind: "compaction",
          text: `Compaction started (${event.reason})`,
          isError: false,
        });
        return "none";
      case "compaction_completed":
        setState({ activity: "" });
        pushEvent({
          seq,
          kind: "compaction",
          text: "Compaction completed",
          isError: false,
        });
        return "replace-snapshot";
      case "compaction_skipped":
        setState({ activity: "" });
        pushEvent({
          seq,
          kind: "compaction",
          text: `Compaction skipped: ${event.cause}`,
          isError: false,
        });
        return "none";
      case "compaction_failed":
        setState({ activity: "" });
        pushEvent({
          seq,
          kind: "compaction",
          text: `Compaction failed: ${event.failure}`,
          isError: true,
        });
        return "none";
      case "error":
        setState({ error: event.message });
        pushEvent({ seq, kind: "error", text: event.message, isError: true });
        return "none";
      case "model_error":
        setState({ error: event.message, modelError: event.message });
        pushEvent({ seq, kind: "error", text: event.message, isError: true });
        return "none";
      default:
        return "none";
    }
  }

  /** Retain a bounded, de-duplicated top-level overlay across snapshot refetches. */
  function pushPrimaryToolEvent(event: AgentEvent): void {
    if (event.type !== "tool_call_started" && event.type !== "tool_call_finished") return;
    setState((state) => {
      const identity = `${event.type}:${event.call_id}`;
      const withoutPrior = state.primaryToolEvents.filter(
        (candidate) =>
          candidate.type !== event.type ||
          !("call_id" in candidate) ||
          `${candidate.type}:${candidate.call_id}` !== identity,
      );
      return { primaryToolEvents: [...withoutPrior, event].slice(-400) };
    });
  }

  const useRunning = (sessionId: string | null) =>
    useStore((state) => state.sessionId === sessionId && state.running);
  const useCancelArmed = (sessionId: string | null) =>
    useStore((state) => state.sessionId === sessionId && state.cancelArmed);
  const useActivity = () => useStore((s) => s.activity);
  const useRunError = () => useStore((s) => s.error);
  const useRunFailure = () => useStore((s) => s.runFailure);
  const useModelRetryAttempt = () => useStore((s) => s.modelRetryAttempt);
  const useLiveEvents = () => useStore((s) => s.events);
  const useStreamStatus = () => useStore((s) => s.streamStatus);
  const usePrimaryToolEvents = () => useStore((s) => s.primaryToolEvents);
  const useRunUsage = () => useStore((s) => s.runUsage);
  const useSessionSpend = () => useStore((s) => s.sessionSpend);
  const useRunStartedAt = () => useStore((s) => s.runStartedAt);
  const useLastElapsedMs = () => useStore((s) => s.lastElapsedMs);
  const useWorkspaceEpoch = () => useStore((s) => s.workspaceEpoch);
  const useStreamText = () => useStore((s) => s.streamText);
  const useStreamReasoning = () => useStore((s) => s.streamReasoning);
  const useOptimisticUserPrompt = () => useStore((s) => s.optimisticUserPrompt);
  return {
    release: () => {
      runtimeStore.setState(initial_runtimeStore);
    },
    runtimeStore,
    captureRuntimeActivation,
    resetRuntime,
    liftSessionSpend,
    setOptimisticUserPrompt,
    applyAssistantDelta,
    setStreamStatus,
    syncRunFromSnapshot,
    pushLocalEvent,
    requestRunCancel,
    restoreRunCancel,
    finishRunCancel,
    applyEnvelope,
    useRunning,
    useCancelArmed,
    useActivity,
    useRunError,
    useRunFailure,
    useModelRetryAttempt,
    useLiveEvents,
    useStreamStatus,
    usePrimaryToolEvents,
    useRunUsage,
    useSessionSpend,
    useRunStartedAt,
    useLastElapsedMs,
    useWorkspaceEpoch,
    useStreamText,
    useStreamReasoning,
    useOptimisticUserPrompt,
    getRuntimeState: getState,
  };
}

export const {
  release,
  runtimeStore,
  captureRuntimeActivation,
  resetRuntime,
  liftSessionSpend,
  setOptimisticUserPrompt,
  applyAssistantDelta,
  setStreamStatus,
  syncRunFromSnapshot,
  pushLocalEvent,
  requestRunCancel,
  restoreRunCancel,
  finishRunCancel,
  applyEnvelope,
  useRunning,
  useCancelArmed,
  useActivity,
  useRunError,
  useRunFailure,
  useModelRetryAttempt,
  useLiveEvents,
  useStreamStatus,
  usePrimaryToolEvents,
  useRunUsage,
  useSessionSpend,
  useRunStartedAt,
  useLastElapsedMs,
  useWorkspaceEpoch,
  useStreamText,
  useStreamReasoning,
  useOptimisticUserPrompt,
  getRuntimeState,
} = createRuntimeStore(standalonePreferenceStorage);
