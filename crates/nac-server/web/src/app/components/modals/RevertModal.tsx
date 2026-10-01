import { useAtomSet, useAtomValue } from "@effect/atom-react";

import { Button, ButtonContent, ButtonSize, ButtonVariant, Modal, ModalSize } from "@/app/atoms";
import { ClientRequestError } from "@/app/effect/errors";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { revertSessionAtom } from "@/app/services/queries";
import { toRunError } from "@/app/lib/providerError";

function commandError(cause: unknown): unknown {
  return cause instanceof ClientRequestError ? cause.error : cause;
}

interface RevertModalProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  /** Snapshot index of the prompt to go back to, or null while closed. */
  messageIdx: number | null;
  /** The prompt itself, so the dialog names the point being restored. */
  prompt: string;
}

/**
 * Confirmation for the one action in the chat that destroys work: the messages
 * after this prompt and the file changes they made are both discarded, and
 * neither comes back.
 */
export function RevertModal({ open, onClose, sessionId, messageIdx, prompt }: RevertModalProps) {
  const toast = useToast();
  const revert = useAtomSet(revertSessionAtom, { mode: "promise" });
  const reverting = useAtomValue(revertSessionAtom).waiting;

  const submit = async () => {
    if (messageIdx == null || reverting) return;
    try {
      const outcome = await revert({ id: sessionId, messageIdx });
      toast.success(
        outcome.workspace_restored
          ? "Reverted to this snapshot"
          : "Transcript reverted; no workspace snapshot covered this point",
      );
      onClose();
    } catch (error) {
      toast.error(`Failed to revert: ${errorMessage(toRunError(commandError(error)))}`);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Revert to this snapshot"
      size={ModalSize.Small}
      footer={
        <>
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Large}
            content={ButtonContent.Text}
            onClick={onClose}
            disabled={reverting}
          >
            Cancel
          </Button>
          <Button
            variant={ButtonVariant.SecondaryDestructive}
            size={ButtonSize.Large}
            content={ButtonContent.Text}
            onClick={submit}
            loading={reverting}
          >
            Revert
          </Button>
        </>
      }
    >
      <p>
        This removes <span className="text-basic-primary">&quot;{prompt}&quot;</span> and everything
        after it from the conversation, and restores the files to how they were when it was sent.
        This action cannot be undone.
      </p>
    </Modal>
  );
}
