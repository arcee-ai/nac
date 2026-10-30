import { useState } from "react";

import { ChatSessionMessage, ChatSessionMessageVariant } from "@/app/atoms";
import {
  useLoginUsability,
  type LoginUsability,
} from "@/app/features/managed/controller/useLoginUsability";
import { ManagedAuthCallout } from "@/app/features/managed/presentation/ManagedAuthCallout";
import { isBackendKind, managedAuthProvider } from "@/app/lib/providers";
import { failureRecoveryAffordance, type LoginRecovery } from "@/app/lib/runFailure";
import type { RunFailure, SessionGoalRecord } from "@/app/types/api";

const LOGIN_RECOVERY = {
  unusable: "needed",
  usable: "restored",
} satisfies Record<Exclude<LoginUsability, "unknown">, LoginRecovery>;

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
  const refusal =
    failure.kind === "authentication" ? `${failure.summary}\n${failure.diagnostic}` : null;
  const usability = useLoginUsability(backend, refusal);
  // A re-check (signing out triggers one) keeps the last answer, so a started sign-in survives.
  const [decided, setDecided] = useState<{ refusal: string | null; login: LoginRecovery }>();
  const current = usability === "unknown" ? null : LOGIN_RECOVERY[usability];
  if (current && (decided?.refusal !== refusal || decided.login !== current))
    setDecided({ refusal, login: current });
  const login = current ?? (decided?.refusal === refusal ? decided.login : "checking");
  const affordance = failureRecoveryAffordance(
    failure,
    goal,
    onRegenerate !== null,
    signsIn ? login : undefined,
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
      diagnostic={failure.diagnostic}
      action={action}
    >
      {explanation}
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
