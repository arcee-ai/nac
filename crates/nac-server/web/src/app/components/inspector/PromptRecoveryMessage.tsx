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
    <div className="type-body-chrome flex flex-col gap-1 rounded-lg bg-[var(--f-wash-1)] px-3 py-2 text-basic-primary">
      <p role="status" className="text-basic-secondary">
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
        <div className="-ml-2 flex flex-wrap gap-1">
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
        <p className="type-meta text-basic-tertiary">
          Your current draft is preserved. Clear it before restoring this message.
        </p>
      ) : null}
    </div>
  );
}
