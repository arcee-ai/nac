import { useState } from "react";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { PermissionControls } from "@/app/components/inspector/PermissionControls";
import { SubagentChatInputBox } from "@/app/components/inspector/SubagentChatInputBox";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useCancelManagedOrchestrator,
  useCancelTraditionalChild,
  useManagedOrchestrators,
  useStartManagedOrchestrator,
  useStartTraditionalChild,
  useTraditionalChildren,
} from "@/app/services/queries";
import type { SessionBehavior, SessionLineage, TraditionalChildStatus } from "@/app/types/api";

export interface SubagentTarget {
  mode: "child" | "orchestrator";
  id: string;
  description: string;
  status: TraditionalChildStatus;
  background: boolean;
}

/** Sends, steers, or stops one existing parent-owned subagent. */
export function SubagentComposer({
  parentSessionId,
  target,
  permissionSessionId,
  permissionBehavior,
  requesterLabel,
  showPermissions = true,
}: {
  parentSessionId: string;
  target: SubagentTarget;
  permissionSessionId: string;
  permissionBehavior: SessionBehavior | null;
  requesterLabel?: string;
  /**
   * The parent composer and a running child's bridge already present permission
   * dialogs. The panel composer must not open a second copy of the same ask.
   */
  showPermissions?: boolean;
}) {
  const toast = useToast();
  const startChild = useStartTraditionalChild();
  const startOrchestrator = useStartManagedOrchestrator();
  const cancelChild = useCancelTraditionalChild();
  const cancelOrchestrator = useCancelManagedOrchestrator();
  // Kept by durable target outside this component, so a remount on a status
  // change or a trip to the transcript and back does not drop an unsent message.
  const drafts = useNativeRuntime().stores.promptDraftStore;
  const draft = drafts.useDraft(target.id);
  const [background, setBackground] = useState(target.background);
  const running = target.status === "running";
  const busy =
    startChild.isPending ||
    startOrchestrator.isPending ||
    cancelChild.isPending ||
    cancelOrchestrator.isPending;

  const submit = async () => {
    const submitted = draft;
    const prompt = submitted.text.trim();
    if (!prompt) return;
    try {
      if (target.mode === "orchestrator") {
        await startOrchestrator.mutateAsync({
          sessionId: parentSessionId,
          payload: {
            description: target.description,
            prompt,
            background,
            orchestrator_session_id: target.id,
          },
        });
      } else {
        await startChild.mutateAsync({
          sessionId: parentSessionId,
          payload: {
            profile: "general",
            description: target.description,
            prompt,
            background,
            child_session_id: target.id,
          },
        });
      }
      // Text typed while the request was in flight is a new message; keep it.
      drafts.acknowledge(target.id, submitted);
    } catch (error) {
      toast.error(`Unable to update the subagent: ${errorMessage(toRunError(error))}`);
    }
  };

  const stop = async () => {
    try {
      if (target.mode === "child") {
        await cancelChild.mutateAsync({
          sessionId: parentSessionId,
          childId: target.id,
        });
      } else {
        await cancelOrchestrator.mutateAsync({
          sessionId: parentSessionId,
          orchestratorId: target.id,
        });
      }
    } catch (error) {
      toast.error(`Unable to stop the subagent: ${errorMessage(toRunError(error))}`);
    }
  };

  return (
    <SubagentChatInputBox
      value={draft.text}
      onChange={(text) => drafts.update(target.id, text)}
      onSubmit={() => void submit()}
      onStop={() => void stop()}
      running={running}
      background={running ? target.background : background}
      onBackgroundChange={setBackground}
      status={target.status}
      busy={busy}
      permission={
        showPermissions ? (
          <PermissionControls
            sessionId={permissionSessionId}
            behavior={permissionBehavior}
            autoApprovalAvailable={false}
            requesterLabel={requesterLabel}
          />
        ) : null
      }
    />
  );
}

/** Composer on a child session page. Steering goes back through the parent. */
export function SubagentSessionComposer({
  parentSessionId,
  sessionId,
  kind,
  description,
  behavior,
}: {
  parentSessionId: string;
  sessionId: string;
  kind: SessionLineage["kind"];
  description: string;
  behavior: SessionBehavior | null;
}) {
  const orchestrator = kind === "managed-orchestrator";
  const children = useTraditionalChildren(parentSessionId, !orchestrator);
  const orchestrators = useManagedOrchestrators(parentSessionId, orchestrator);
  const record = orchestrator
    ? orchestrators.data?.find((item) => item.orchestrator_session_id === sessionId)
    : children.data?.find((item) => item.child_session_id === sessionId);
  const target: SubagentTarget = {
    mode: orchestrator ? "orchestrator" : "child",
    id: sessionId,
    description: record?.description || description || "Subagent",
    status: record?.status ?? "idle",
    background: record?.execution_mode !== "foreground",
  };
  return (
    <SubagentComposer
      key={`${target.mode}:${target.id}:${target.status}:${target.background}`}
      parentSessionId={parentSessionId}
      target={target}
      permissionSessionId={sessionId}
      permissionBehavior={orchestrator ? "orchestrator" : (behavior ?? "direct")}
      requesterLabel={orchestrator ? undefined : `child agent “${target.description}”`}
    />
  );
}
