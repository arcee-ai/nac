import { useLocation, useNavigate } from "react-router-dom";

import { Button, ButtonContent, ButtonVariant, Modal, ModalSize } from "@/app/atoms";
import { toRunError } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useDeleteProject } from "@/app/services/queries";
import type { DeleteProjectSessions, ProjectRecord } from "@/app/types/api";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

const plural = (count: number) => (count === 1 ? "chat" : "chats");

export function DeleteProjectModal({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectRecord | null;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const remove = useDeleteProject();
  const isMobile = useIsMobile();
  const submit = async (sessions: DeleteProjectSessions) => {
    if (!project || remove.isPending) return;
    try {
      const result = await remove.mutateAsync({
        projectId: project.project_id,
        sessions,
      });
      // Any screen scoped to this project has nothing left to show.
      if (location.pathname.startsWith(`/project/${encodeURIComponent(project.project_id)}`)) {
        navigate(routes.list(), { replace: true });
      }
      const kept = result?.released_session_ids?.length ?? 0;
      const deleted = result?.deleted_session_ids?.length ?? 0;
      toast.success(
        deleted > 0
          ? `Project and ${deleted} ${plural(deleted)} deleted`
          : kept > 0
            ? `Project deleted; ${kept} ${plural(kept)} kept`
            : "Project deleted",
      );
      onClose();
    } catch (error) {
      toast.error(`Failed to delete: ${errorMessage(toRunError(error))}`);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete project"
      size={ModalSize.Medium}
      footer={
        <>
          {!isMobile && (
            <Button
              variant={ButtonVariant.Tertiary}
              content={ButtonContent.Text}
              onClick={onClose}
              disabled={remove.isPending}
            >
              Cancel
            </Button>
          )}
          <Button
            variant={ButtonVariant.Secondary}
            content={ButtonContent.Text}
            onClick={() => void submit("keep")}
            disabled={remove.isPending}
          >
            Delete and keep sessions
          </Button>
          <Button
            variant={ButtonVariant.SecondaryDestructive}
            content={ButtonContent.Text}
            onClick={() => void submit("delete")}
            loading={remove.isPending}
          >
            Delete All
          </Button>
        </>
      }
    >
      <p>
        Delete the project <span className="text-basic-primary">&quot;{project?.name}&quot;</span>?
        Its chats can stay behind as unassigned, so nothing said in them is lost, or go down with it
        — which cannot be undone.
      </p>
    </Modal>
  );
}
