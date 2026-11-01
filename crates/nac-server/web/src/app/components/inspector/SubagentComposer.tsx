import { useState } from "react";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { PermissionControls } from "@/app/components/inspector/PermissionControls";
import { SubagentChatInputBox } from "@/app/components/inspector/SubagentChatInputBox";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import type { PromptRecovery } from "@/app/store/promptDraftStore";
import { PromptRecoveryMessage } from "./PromptRecoveryMessage";
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
  floating = false,
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
  floating?: boolean;
}) {
  const toast = useToast();
  const isMobile = useIsMobile();
  const startChild = useStartTraditionalChild();
  const startOrchestrator = useStartManagedOrchestrator();
  const cancelChild = useCancelTraditionalChild();
  const cancelOrchestrator = useCancelManagedOrchestrator();
  // Stored by durable target so status remounts and transcript trips keep the draft.
  const drafts = useNativeRuntime().stores.promptDraftStore;
  const draft = drafts.useDraft(target.id);
  const recoveries = [...drafts.useUnreviewed(target.id), ...drafts.useRecoveries(target.id)];
  const retentionLimited = drafts.useRetentionLimited();
  // Held in the runtime store, so a remount cannot start the same target twice.
  const starting = drafts.useSubmitting(target.id);
  const [selectedBackground, setBackground] = useState<boolean | null>(null);
  const background = selectedBackground ?? target.background;
  const running = target.status === "running";
  const busy = drafts.useCancelling(target.id);

  const submit = async () => {
    const submitted = drafts.get(target.id);
    const prompt = submitted.text.trim();
    if (!prompt) return;
    // A start waits for the target; a running target takes further steering meanwhile.
    const finish = drafts.claimSubmission(target.id);
    if (!finish && !running) return;
    let recovery: PromptRecovery | null = null;
    try {
      // Retain exact text before clearing the captured revision. This is recovery
      // evidence, not an outbox: navigation/reload must never replay it.
      recovery = drafts.retainSubmission(target.id, submitted);
      if (!recovery) return;
      drafts.acknowledge(target.id, submitted);
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
      drafts.settleSubmission(target.id, recovery, "confirmed");
    } catch (error) {
      // A lost response can follow a successful delivery. Preserve it separately
      // from the next draft and require an explicit human recovery decision.
      // Foreground endpoints can fail after admission, even with 4xx; an HTTP
      // error alone cannot prove that no delivery happened.
      if (recovery) drafts.settleSubmission(target.id, recovery, "uncertain");
      toast.error(`Unable to update the subagent: ${errorMessage(toRunError(error))}`);
    } finally {
      finish?.();
    }
  };

  const stop = async () => {
    const finish = drafts.claimCancellation(target.id);
    if (!finish) return;
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
    } finally {
      finish();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <SubagentChatInputBox
        value={draft.text}
        onChange={(text) => drafts.update(target.id, text)}
        onSubmit={() => void submit()}
        onStop={() => void stop()}
        running={running}
        background={running ? target.background : background}
        onBackgroundChange={setBackground}
        busy={busy}
        starting={starting}
        floating={floating}
        permission={
          showPermissions ? (
            <PermissionControls
              sessionId={permissionSessionId}
              behavior={permissionBehavior}
              autoApprovalAvailable={false}
              retryParentSessionId={target.mode === "child" ? parentSessionId : undefined}
              poll={running}
              requesterLabel={requesterLabel}
              compact={isMobile}
            />
          ) : null
        }
      />
      {retentionLimited ? (
        <p role="status" className="text-small text-basic-secondary">
          Text recovery storage is full or unavailable. You can keep typing and sending; new edits
          may not restore. Review or dismiss older text to free space.
        </p>
      ) : null}
      {recoveries.length ? (
        <div
          role="region"
          aria-label="Subagent message delivery"
          className="pointer-events-auto flex max-h-48 flex-col gap-2 overflow-y-auto"
        >
          {recoveries.map((recovery) => (
            <PromptRecoveryMessage
              key={recovery.id}
              recovery={recovery}
              hasDraft={!!draft.text}
              onRestore={() => drafts.restoreRecovery(target.id, recovery)}
              onDismiss={() => drafts.dismissRecovery(target.id, recovery)}
            />
          ))}
        </div>
      ) : null}
    </div>
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
      key={`${target.mode}:${target.id}`}
      parentSessionId={parentSessionId}
      target={target}
      permissionSessionId={sessionId}
      permissionBehavior={orchestrator ? "orchestrator" : (behavior ?? "direct")}
      requesterLabel={orchestrator ? undefined : `child agent “${target.description}”`}
      floating
    />
  );
}
