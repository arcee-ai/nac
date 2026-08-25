import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, ButtonVariant, Modal, ModalSize } from "@/app/atoms";
import { SessionBehaviorPicker } from "@/app/components/modals/SessionBehaviorPicker";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
import { useToast } from "@/app/providers/ToastProvider";
import { useCreateSession } from "@/app/services/queries";
import type { SessionBehavior } from "@/app/types/api";

export function NewChatModal({
  projectId,
  onClose,
}: {
  projectId: string | null;
  onClose: () => void;
}) {
  const mounted = useExitTransition(projectId !== null);
  if (!mounted || projectId === null) return null;
  return <NewChatForm projectId={projectId} onClose={onClose} />;
}

function NewChatForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const createSession = useCreateSession();
  const [behavior, setBehavior] = useState<SessionBehavior>("orchestrator");

  const submit = async () => {
    try {
      const snapshot = await createSession.mutateAsync({ project_id: projectId, behavior });
      const sessionId = snapshot.metadata.session_id;
      onClose();
      if (sessionId) navigate(routes.session(sessionId));
    } catch (error) {
      toast.error(`Failed to start a chat: ${humanErrorText(toRunError(error))}`);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size={ModalSize.Wide}
      title="New Chat"
      subheader="Choose the execution behavior for this chat. The project and model settings are inherited."
      footer={
        <Button
          variant={ButtonVariant.Primary}
          loading={createSession.isPending}
          disabled={createSession.isPending}
          onClick={() => void submit()}
        >
          Create chat
        </Button>
      }
    >
      <SessionBehaviorPicker
        value={behavior}
        onChange={setBehavior}
        disabled={createSession.isPending}
      />
    </Modal>
  );
}
