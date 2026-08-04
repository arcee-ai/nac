import {
  Button,
  ButtonContent,
  ButtonVariant,
  Modal,
  ModalSize,
} from "@/app/atoms";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useRevertSession } from "@/app/services/queries";

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
export function RevertModal({
  open,
  onClose,
  sessionId,
  messageIdx,
  prompt,
}: RevertModalProps) {
  const toast = useToast();
  const revert = useRevertSession();

  const submit = async () => {
    if (messageIdx == null || revert.isPending) return;
    try {
      const outcome = await revert.mutateAsync({ id: sessionId, messageIdx });
      toast.success(
        outcome.workspace_restored
          ? "Reverted to this snapshot"
          : "Transcript reverted; no workspace snapshot covered this point",
      );
      onClose();
    } catch (error) {
      toast.error(`Failed to revert: ${errorMessage(error)}`);
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
            variant={ButtonVariant.Tertiary}
            content={ButtonContent.Text}
            onClick={onClose}
            disabled={revert.isPending}
          >
            Cancel
          </Button>
          <Button
            variant={ButtonVariant.SecondaryDestructive}
            content={ButtonContent.Text}
            onClick={submit}
            loading={revert.isPending}
          >
            Revert
          </Button>
        </>
      }
    >
      <p>
        This removes{" "}
        <span className="text-basic-primary">&quot;{prompt}&quot;</span> and
        everything after it from the conversation, and restores the files to how
        they were when it was sent. This action cannot be undone.
      </p>
    </Modal>
  );
}
