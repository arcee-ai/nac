import { useState } from "react";

import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useCopyToClipboard } from "@/app/hooks/useCopyToClipboard";
import { PermissionControls } from "@/app/components/inspector/PermissionControls";
import { SubagentChatInputBox } from "@/app/components/inspector/SubagentChatInputBox";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import type { PromptRecovery } from "@/app/store/promptDraftStore";
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

function RecoveryMessage({
  recovery,
  hasDraft,
  onRestore,
  onDismiss,
}: {
  recovery: PromptRecovery;
  hasDraft: boolean;
  onRestore: () => void;
  onDismiss: () => void;
}) {
  const { copy, copied } = useCopyToClipboard();
  return (
    <div className="rounded-[4px] bg-elevation-level-2 p-3 text-small">
      <p role="status">
        {recovery.status === "pending"
          ? "Sending message…"
          : recovery.status === "not-sent"
            ? "Message was not sent."
            : "Message delivery is unconfirmed. Check the transcript before sending it again."}
      </p>
      <p className="max-h-32 overflow-auto whitespace-pre-wrap break-words">{recovery.text}</p>
      {recovery.status !== "pending" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            disabled={hasDraft}
            onClick={onRestore}
          >
            Restore to composer
          </Button>
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            onClick={() => copy(recovery.text)}
          >
            {copied ? "Copied" : "Copy message"}
          </Button>
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        </div>
      ) : null}
      {recovery.status !== "pending" && hasDraft ? (
        <p className="text-basic-tertiary">
          Your current draft is preserved. Clear it before restoring this message.
        </p>
      ) : null}
    </div>
  );
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
  const startChild = useStartTraditionalChild();
  const startOrchestrator = useStartManagedOrchestrator();
  const cancelChild = useCancelTraditionalChild();
  const cancelOrchestrator = useCancelManagedOrchestrator();
  // Stored by durable target so status remounts and transcript trips keep the draft.
  const drafts = useNativeRuntime().stores.promptDraftStore;
  const draft = drafts.useDraft(target.id);
  const recoveries = drafts.useRecoveries(target.id);
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
            />
          ) : null
        }
      />
      {recoveries.length ? (
        <div
          role="region"
          aria-label="Subagent message delivery"
          className="pointer-events-auto flex max-h-48 flex-col gap-2 overflow-y-auto"
        >
          {recoveries.map((recovery) => (
            <RecoveryMessage
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
