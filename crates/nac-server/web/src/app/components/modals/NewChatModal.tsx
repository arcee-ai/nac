import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, ButtonVariant, Modal, ModalSize } from "@/app/atoms";
import { SessionBehaviorPicker } from "@/app/components/modals/SessionBehaviorPicker";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { newestPrimarySessionForProject } from "@/app/lib/projects";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
import { useToast } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { useCreateSession } from "@/app/services/queries";
import type { SessionBehavior } from "@/app/types/api";

export function NewChatModal({
  projectId,
  firstChat = false,
  onClose,
}: {
  projectId: string | null;
  firstChat?: boolean;
  onClose: () => void;
}) {
  const mounted = useExitTransition(projectId !== null);
  if (!mounted || projectId === null) return null;
  return <NewChatForm projectId={projectId} firstChat={firstChat} onClose={onClose} />;
}

function NewChatForm({
  projectId,
  firstChat,
  onClose,
}: {
  projectId: string;
  firstChat: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const createSession = useCreateSession();
  const [behavior, setBehavior] = useState<SessionBehavior>("orchestrator");

  const submit = async () => {
    try {
      if (firstChat) {
        const [projects, sessions] = await Promise.all([
          api.listProjects(),
          api.listSessions({ projectId }),
        ]);
        if (!projects.projects.some((project) => project.project_id === projectId)) {
          onClose();
          navigate(routes.list(), { replace: true });
          return;
        }
        const existing = newestPrimarySessionForProject(sessions, projectId);
        if (existing) {
          onClose();
          navigate(routes.session(existing.summary.session_id), { replace: true });
          return;
        }
      }
      const snapshot = await createSession.mutateAsync({
        project_id: projectId,
        behavior,
        first_chat: firstChat,
      });
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
