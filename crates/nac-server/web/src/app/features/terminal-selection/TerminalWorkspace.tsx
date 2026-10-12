import { useMemo } from "react";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useSessionSnapshot } from "@/app/services/queries";
import { TerminalPane } from "@/app/features/terminal/TerminalPane";
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
  const snapshot = useSessionSnapshot(sessionId);
  const running = useNativeRuntime().stores.runtimeStore.useRunning(sessionId);
  const runId = snapshot.data?.active_run?.run_id;
  const mode = running || runId ? "busy" : snapshot.data && !snapshot.isError ? "idle" : "unknown";
  return (
    <>
      <TerminalPane
        sessionId={sessionId}
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
