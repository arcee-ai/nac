import { ChatSessionMessage, ChatSessionMessageVariant } from "@/app/atoms";
import { useLoginUsability } from "@/app/features/managed/controller/useLoginUsability";
import { ManagedAuthCallout } from "@/app/features/managed/presentation/ManagedAuthCallout";
import { isBackendKind, managedAuthProvider } from "@/app/lib/providers";
import { failureRecoveryAffordance } from "@/app/lib/runFailure";
import type { RunFailure, SessionGoalRecord } from "@/app/types/api";

/** A run's durable failure with its recovery, a sign-in first for a refused login. */
export function RunFailureRecovery({
  failure,
  goal,
  backend,
  onResumeGoal,
  onOpenSettings,
  onRegenerate,
}: {
  failure: RunFailure;
  goal: SessionGoalRecord | null | undefined;
  backend: string | null;
  onResumeGoal: () => void;
  onOpenSettings: () => void;
  onRegenerate: (() => void) | null;
}) {
  const signsIn = backend !== null && managedAuthProvider(backend) !== null;
  const usability = useLoginUsability(
    backend,
    failure.kind === "authentication" ? `${failure.summary}\n${failure.diagnostic}` : null,
  );
  const affordance = failureRecoveryAffordance(
    failure,
    goal,
    onRegenerate !== null,
    signsIn ? (usability === "usable" ? "restored" : "needed") : undefined,
  );
  const action =
    affordance === "resume_goal"
      ? { label: "Resume goal", onClick: onResumeGoal }
      : affordance === "settings"
        ? { label: "Open settings", onClick: onOpenSettings }
        : affordance === "regenerate" && onRegenerate
          ? { label: "Regenerate from original prompt", onClick: onRegenerate }
          : undefined;

  return (
    <>
      <RunFailureNotice failure={failure} goal={goal} action={action} />
      {affordance === "sign_in" && backend && isBackendKind(backend) ? (
        <ManagedAuthCallout backend={backend} className="mt-2" rejected />
      ) : null}
    </>
  );
}

export function RunFailureNotice({
  failure,
  goal,
  action,
}: {
  failure: RunFailure;
  goal?: SessionGoalRecord | null;
  action?: { label: string; onClick: () => void };
}) {
  const retryScheduled = failure.recovery_action === "automatic_retry" && goal?.status === "active";
  const retryExhausted = failure.recovery_action === "resume_goal" && goal?.status === "blocked";
  const providerCapacity = failure.kind === "capacity";
  const partial = Boolean(
    failure.partial_output?.text ||
    failure.partial_output?.reasoning ||
    failure.partial_output?.tool_call,
  );
  const title = providerCapacity
    ? failure.summary
    : retryScheduled
      ? "Goal retry scheduled"
      : retryExhausted
        ? "Goal stopped after repeated run failures"
        : partial
          ? "Run stopped after a partial response"
          : failure.summary;
  const retryTime = goal?.next_attempt_at_epoch_ms
    ? new Date(goal.next_attempt_at_epoch_ms).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;
  const summaryPrefix = providerCapacity ? "" : `${failure.summary} `;
  const explanation = retryScheduled
    ? `${summaryPrefix}The durable goal and its usage were preserved. NAC will continue automatically${retryTime ? ` at ${retryTime}` : ""}.`
    : retryExhausted
      ? `${summaryPrefix}The durable goal and its usage were preserved. Resume it when you want another bounded retry sequence.`
      : providerCapacity
        ? `Retrying later may be necessary.${providerRetryDelay(failure.retry_after_ms)}`
        : failure.summary;
  return (
    <ChatSessionMessage
      role={retryScheduled ? "status" : "alert"}
      variant={retryScheduled ? ChatSessionMessageVariant.Info : ChatSessionMessageVariant.Danger}
      title={title}
      action={action}
    >
      <span>{explanation}</span>
      <details className="mt-2">
        <summary className="cursor-pointer">Diagnostics</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
          {failure.diagnostic}
        </pre>
      </details>
    </ChatSessionMessage>
  );
}

function providerRetryDelay(retryAfterMs: number | null | undefined): string {
  if (retryAfterMs == null) return "";
  if (retryAfterMs >= 60_000 && retryAfterMs % 60_000 === 0) {
    const minutes = retryAfterMs / 60_000;
    return ` The provider asked NAC to wait at least ${minutes} ${minutes === 1 ? "minute" : "minutes"} before retrying.`;
  }
  if (retryAfterMs >= 1_000 && retryAfterMs % 1_000 === 0) {
    const seconds = retryAfterMs / 1_000;
    return ` The provider asked NAC to wait at least ${seconds} ${seconds === 1 ? "second" : "seconds"} before retrying.`;
  }
  return ` The provider asked NAC to wait at least ${retryAfterMs} milliseconds before retrying.`;
}
