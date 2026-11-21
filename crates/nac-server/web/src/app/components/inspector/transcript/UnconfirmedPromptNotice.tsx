import { useEffect, useState } from "react";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { ChatSessionMessage, ChatSessionMessageVariant } from "@/app/atoms";
import { MAX_DISMISSED_PROMPT_RUNS } from "@/app/store/runtimeStore";

/** A local display choice only: it never retries or changes the transcript. */
export function UnconfirmedPromptNotice({
  visible,
  onDismiss,
  canDismiss = true,
}: {
  visible: boolean;
  onDismiss: () => void;
  canDismiss?: boolean;
}) {
  return visible ? <DelayedNotice onDismiss={onDismiss} canDismiss={canDismiss} /> : null;
}

function DelayedNotice({ onDismiss, canDismiss }: { onDismiss: () => void; canDismiss: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 2000);
    return () => clearTimeout(timer);
  }, []);
  if (!ready) return null;
  return (
    <ChatSessionMessage
      role="status"
      title="Message not confirmed"
      variant={ChatSessionMessageVariant.Info}
      className="mt-6"
      action={canDismiss ? { label: "Hide unconfirmed message", onClick: onDismiss } : undefined}
    >
      {canDismiss
        ? "This message may have been sent. Check the conversation before sending it again."
        : "This message may have been sent. Reopen this session to refresh the conversation."}
    </ChatSessionMessage>
  );
}

/** Bind the recovery action to the exact current session and submission. */
export function UnconfirmedPromptRecovery({
  sessionId,
  showPending,
  running,
  token,
}: {
  sessionId: string;
  showPending: boolean;
  running: boolean;
  token: number | null;
}) {
  const { runtimeStore, dismissOptimisticPrompt } = useNativeRuntime().stores.runtimeStore;
  const currentSession = runtimeStore.useStore((state) => state.sessionId);
  const currentToken = runtimeStore.useStore((state) => state.optimisticPromptToken);
  const runId = runtimeStore.useStore((state) => state.optimisticPromptRunId);
  const uncertain = runtimeStore.useStore((state) => state.optimisticPromptUncertain);
  const streamStatus = runtimeStore.useStore((state) => state.streamStatus);
  const dismissed = runtimeStore.useStore((state) => state.dismissedPromptRunIds);
  const canDismiss =
    !runId || dismissed.includes(runId) || dismissed.length < MAX_DISMISSED_PROMPT_RUNS;
  return (
    <UnconfirmedPromptNotice
      key={token ?? "none"}
      visible={Boolean(
        showPending &&
        (!running || streamStatus !== "live") &&
        token != null &&
        currentSession === sessionId &&
        currentToken === token &&
        (runId || uncertain),
      )}
      canDismiss={canDismiss}
      onDismiss={() => {
        if (token != null) dismissOptimisticPrompt(token);
      }}
    />
  );
}
