import { useLocation, useNavigate } from "react-router-dom";

import { Button, ButtonContent, ButtonVariant, Modal, ModalSize } from "@/app/atoms";
import { toRunError } from "@/app/lib/providerError";
import { routes, sessionIdFromPath } from "@/app/lib/routes";
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
      const deletedIds = result?.deleted_session_ids ?? [];
      const currentSessionId = sessionIdFromPath(location.pathname);
      const onProjectRoute = location.pathname.startsWith(
        `/project/${encodeURIComponent(project.project_id)}`,
      );
      // `/project/:id` is rare — opening a project lands on `/session/:id`.
      // Delete All has to leave that route too, or the browser stays on a
      // session that no longer exists.
      if (onProjectRoute || (currentSessionId && deletedIds.includes(currentSessionId))) {
        navigate(routes.list(), { replace: true });
      }
      const kept = result?.released_session_ids?.length ?? 0;
      const deleted = deletedIds.length;
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
      title="Delete Entire Project?"
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
            Keep Sessions
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
      <div className="flex flex-col gap-4">
        <p>
          Are you sure you want to delete{" "}
          <span className="text-basic-primary">&quot;{project?.name}&quot;</span>? This can&apos;t
          be undone.
        </p>
        <p>
          Select Keep Sessions if you want to delete the project and keep the sessions within it.
          Those sessions will be unassigned.
        </p>
      </div>
    </Modal>
  );
}
