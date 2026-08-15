import { useLocation, useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonVariant,
  Modal,
  ModalSize,
} from "@/app/atoms";
import { displaySessionTitle, shortId } from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useDeleteSession } from "@/app/services/queries";
import type { SessionSummarySnapshot } from "@/app/types/api";
import { toRunError } from "@/app/lib/providerError";

interface DeleteModalProps {
  open: boolean;
  onClose: () => void;
  summary: SessionSummarySnapshot | null;
}

export function DeleteModal({ open, onClose, summary }: DeleteModalProps) {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const remove = useDeleteSession();

  const submit = async () => {
    if (!summary || remove.isPending) return;
    const id = summary.session_id;
    try {
      await remove.mutateAsync(id);
      // A deleted session cannot stay on screen; fall back to the list.
      if (location.pathname.startsWith(`/session/${encodeURIComponent(id)}`)) {
        navigate(routes.list(), { replace: true });
      }
      toast.success("Session deleted");
      onClose();
    } catch (error) {
      toast.error(`Failed to delete: ${errorMessage(toRunError(error))}`);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete session"
      size={ModalSize.Small}
      footer={
        <>
          <Button
            variant={ButtonVariant.Tertiary}
            content={ButtonContent.Text}
            onClick={onClose}
            disabled={remove.isPending}
          >
            Cancel
          </Button>
          <Button
            variant={ButtonVariant.SecondaryDestructive}
            content={ButtonContent.Text}
            onClick={submit}
            loading={remove.isPending}
          >
            Delete session
          </Button>
        </>
      }
    >
      <p>
        Are you sure you want to delete the session{" "}
        <span className="text-basic-primary">
          &quot;{displaySessionTitle(summary)}&quot;
        </span>{" "}
        <span className="font-mono text-basic-muted">
          ({shortId(summary?.session_id)})
        </span>
        ? This action cannot be undone.
      </p>
    </Modal>
  );
}
