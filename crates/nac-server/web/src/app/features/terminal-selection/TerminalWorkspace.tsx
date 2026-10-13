import { useMemo } from "react";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useSessionSnapshot } from "@/app/services/queries";
import { TerminalPane } from "@/app/features/terminal/TerminalPane";
import { RecentExecutionHistory } from "@/app/features/terminal/RecentExecutionHistory";
import { useUserTerminalStatus } from "@/app/features/terminal/queries";
import { SelectionReview, type ReviewAvailability } from "./SelectionReview";
import type { ReviewSnapshot, SelectionReviewController } from "./reviewController";
import { useSelectionReview } from "./useSelectionReview";

/** A consumer or chat replacement discards this local, unsent review. */
export function TerminalWorkspace({ sessionId }: { sessionId: string }) {
  const { api } = useNativeRuntime();
  const binding = useMemo(() => ({ api, id: crypto.randomUUID() }), [api]);
  return <WorkspaceOwner key={`${binding.id}:${sessionId}`} sessionId={sessionId} />;
}

function WorkspaceOwner({ sessionId }: { sessionId: string }) {
  const { controller, state } = useSelectionReview(sessionId);
  // Availability is advisory cached state. Opening this observer must not
  // attach a session or reconcile its journal; submission revalidates intent.
  const snapshot = useSessionSnapshot(sessionId, { enabled: false });
  const running = useNativeRuntime().stores.runtimeStore.useRunning(sessionId);
  const runId = snapshot.data?.active_run?.run_id;
  const commandActive = snapshot.data?.shell_commands?.some(
    (command) => command.state === "accepted" || command.state === "started",
  );
  const mode =
    running || runId || commandActive
      ? "busy"
      : snapshot.data && !snapshot.isError
        ? "idle"
        : "unknown";
  return (
    <>
      <TerminalPane
        sessionId={sessionId}
        history={(observe) => <RecentExecutionHistory sessionId={sessionId} onReopen={observe} />}
        onReviewSelection={(capture) =>
          controller.capture(capture, { delivery: mode === "idle" ? "send" : "queue" })
        }
      />
      {state.source ? (
        <SourceReview
          key={`${state.source.sessionId}:${state.source.terminalId}`}
          state={state}
          controller={controller}
          availability={{ mode, runId }}
        />
      ) : null}
    </>
  );
}

function SourceReview({
  state,
  controller,
  availability,
}: {
  state: ReviewSnapshot;
  controller: SelectionReviewController;
  availability: ReviewAvailability;
}) {
  const source = state.source!;
  const status = useUserTerminalStatus(source.sessionId, source.terminalId);
  return (
    <SelectionReview
      state={state}
      controller={controller}
      availability={{
        ...availability,
        sourceAlive: status.data?.alive,
        sourceUnavailable: status.isError,
      }}
    />
  );
}
