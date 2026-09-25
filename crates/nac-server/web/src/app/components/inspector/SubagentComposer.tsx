import { useState } from "react";

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

export type SubagentTarget =
  | { mode: "new-agent" }
  | { mode: "new-orchestrator" }
  | {
      mode: "child" | "orchestrator";
      id: string;
      description: string;
      status: TraditionalChildStatus;
      background: boolean;
    };

function descriptionFromPrompt(prompt: string): string {
  const line = prompt.trim().split("\n")[0] ?? "";
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

/**
 * Sends, steers, or stops one parent-owned subagent. A new launch takes its
 * description from the first line of the prompt.
 */
export function SubagentComposer({
  parentSessionId,
  target,
  permissionSessionId,
  permissionBehavior,
  requesterLabel,
  onStarted,
  autoFocus = false,
  focusRequest = 0,
}: {
  parentSessionId: string;
  target: SubagentTarget;
  permissionSessionId: string;
  permissionBehavior: SessionBehavior | null;
  requesterLabel?: string;
  onStarted?: (id: string) => void;
  autoFocus?: boolean;
  focusRequest?: number;
}) {
  const toast = useToast();
  const startChild = useStartTraditionalChild();
  const startOrchestrator = useStartManagedOrchestrator();
  const cancelChild = useCancelTraditionalChild();
  const cancelOrchestrator = useCancelManagedOrchestrator();
  const [value, setValue] = useState("");
  const [background, setBackground] = useState(
    target.mode === "child" || target.mode === "orchestrator" ? target.background : true,
  );
  const running =
    (target.mode === "child" || target.mode === "orchestrator") && target.status === "running";
  const busy =
    startChild.isPending ||
    startOrchestrator.isPending ||
    cancelChild.isPending ||
    cancelOrchestrator.isPending;
  const existing = target.mode === "child" || target.mode === "orchestrator" ? target : null;

  const submit = async () => {
    const prompt = value.trim();
    if (!prompt) return;
    const description = existing ? existing.description : descriptionFromPrompt(prompt);
    if (!description) {
      toast.error("A message is required.");
      return;
    }
    try {
      if (target.mode === "new-orchestrator" || target.mode === "orchestrator") {
        const started = await startOrchestrator.mutateAsync({
          sessionId: parentSessionId,
          payload: {
            description,
            prompt,
            background,
            orchestrator_session_id: target.mode === "orchestrator" ? target.id : null,
          },
        });
        onStarted?.(started.orchestrator_session_id);
      } else {
        const started = await startChild.mutateAsync({
          sessionId: parentSessionId,
          payload: {
            profile: "general",
            description,
            prompt,
            background,
            child_session_id: target.mode === "child" ? target.id : null,
          },
        });
        onStarted?.(started.child_session_id);
      }
      setValue("");
    } catch (error) {
      toast.error(`Unable to update the subagent: ${errorMessage(toRunError(error))}`);
    }
  };

  const stop = async () => {
    if (!existing) return;
    try {
      if (existing.mode === "child") {
        await cancelChild.mutateAsync({ sessionId: parentSessionId, childId: existing.id });
      } else {
        await cancelOrchestrator.mutateAsync({
          sessionId: parentSessionId,
          orchestratorId: existing.id,
        });
      }
    } catch (error) {
      toast.error(`Unable to stop the subagent: ${errorMessage(toRunError(error))}`);
    }
  };

  return (
    <SubagentChatInputBox
      value={value}
      onChange={setValue}
      onSubmit={() => void submit()}
      onStop={() => void stop()}
      autoFocus={autoFocus}
      focusRequest={focusRequest}
      running={running}
      background={running && existing ? existing.background : background}
      onBackgroundChange={setBackground}
      status={existing?.status}
      busy={busy}
      permission={
        <PermissionControls
          sessionId={permissionSessionId}
          behavior={permissionBehavior}
          autoApprovalAvailable={false}
          requesterLabel={requesterLabel}
        />
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
