import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { useCopyToClipboard } from "@/app/hooks/useCopyToClipboard";
import type { PromptRecovery } from "@/app/store/promptDraftStore";

export function PromptRecoveryMessage({
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
        {recovery.source === "checkpoint"
          ? "Recovered text may be stale or already sent. Check the transcript before restoring it."
          : recovery.status === "pending"
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
