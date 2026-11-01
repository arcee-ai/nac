import { useState } from "react";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { PermissionControls } from "@/app/components/inspector/PermissionControls";
import { SubagentChatInputBox } from "@/app/components/inspector/SubagentChatInputBox";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { withPromptRecovery } from "@/app/features/direct-session/promptRecovery";
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
  const unretainedSubmission = drafts.useUnretainedSubmission(target.id);
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
    // One start at a time; a running target accepts distinct fresh steering.
    if (!running && drafts.isSubmitting(target.id)) return;
    const finish = drafts.claimSubmission(target.id, submitted);
    if (!finish) return;
    let retained = false;
    try {
      await withPromptRecovery(
        drafts,
        target.id,
        submitted,
        async () => {
          if (target.mode === "orchestrator") {
            return startOrchestrator.mutateAsync({
              sessionId: parentSessionId,
              payload: {
                description: target.description,
                prompt,
                background,
                orchestrator_session_id: target.id,
              },
            });
          }
          return startChild.mutateAsync({
            sessionId: parentSessionId,
            payload: {
              profile: "general",
              description: target.description,
              prompt,
              background,
              child_session_id: target.id,
            },
          });
        },
        () => {
          retained = true;
          drafts.acknowledge(target.id, submitted);
        },
      );
      // Without a recovery entry, preserve the captured live revision until
      // definite acknowledgement. A newer (even identical) edit never matches.
      if (drafts.hasSubmission(target.id, submitted)) drafts.acknowledge(target.id, submitted);
    } catch (error) {
      if (!drafts.hasSubmission(target.id, submitted)) return;
      if (!retained) drafts.noteUnretainedSubmission(target.id, submitted);
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
      {unretainedSubmission ? (
        <div role="status" className="text-small text-basic-secondary">
          <p>
            Message delivery is unconfirmed. Submitted text was not saved for recovery. Check the
            transcript before sending again.
          </p>
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            onClick={() => drafts.dismissUnretainedSubmission(target.id, unretainedSubmission)}
          >
            Acknowledge delivery uncertainty
          </Button>
        </div>
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
