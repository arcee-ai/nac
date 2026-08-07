import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, ButtonContent, ButtonVariant, Modal, ModalSize, Input } from "@/app/atoms";
import { routes } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { ApiError } from "@/app/services/api";
import { queryKeys, useForkSession } from "@/app/services/queries";

interface ForkModalProps {
  open: boolean;
  onClose: () => void;
  sourceId: string;
  boundaryToken: string | null;
}

export function ForkModal({ open, onClose, sourceId, boundaryToken }: ForkModalProps) {
  const [title, setTitle] = useState("");
  const fork = useForkSession();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();

  const submit = async () => {
    if (!boundaryToken || fork.isPending) return;
    try {
      const snapshot = await fork.mutateAsync({
        sourceId,
        payload: { boundary_token: boundaryToken, ...(title.trim() ? { title: title.trim() } : {}) },
      });
      const childId = snapshot.metadata.session_id;
      if (!childId) throw new Error("Fork response did not include a session id");
      onClose();
      toast.success("Forked into a new session");
      navigate(routes.session(childId));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await client.invalidateQueries({ queryKey: queryKeys.session(sourceId) });
        toast.error("That boundary changed. The conversation was refreshed; choose it again.");
        onClose();
        return;
      }
      toast.error(`Failed to fork: ${errorMessage(error)}`);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Fork conversation" size={ModalSize.Small}
      footer={<>
        <Button variant={ButtonVariant.Tertiary} content={ButtonContent.Text} onClick={onClose} disabled={fork.isPending}>Cancel</Button>
        <Button variant={ButtonVariant.Primary} content={ButtonContent.Text} onClick={submit} loading={fork.isPending} disabled={!boundaryToken}>Create fork</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <p>The new session copies the conversation through this point and the validated model configuration. It starts inactive with no workers or run state.</p>
        <p className="text-basic-muted">Both sessions use the same workspace, so file changes remain shared.</p>
        <Input label="Title (optional)" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="New session title" />
      </div>
    </Modal>
  );
}
