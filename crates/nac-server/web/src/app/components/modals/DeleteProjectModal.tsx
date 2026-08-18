import { useLocation, useNavigate } from "react-router-dom";

import { Button, ButtonContent, ButtonVariant, Modal, ModalSize } from "@/app/atoms";
import { routes } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useDeleteProject } from "@/app/services/queries";
import type { ProjectRecord } from "@/app/types/api";
import { toRunError } from "@/app/lib/providerError";

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

  const submit = async () => {
    if (!project || remove.isPending) return;
    try {
      const { released_session_ids } = await remove.mutateAsync(project.project_id);
      // Any screen scoped to this project has nothing left to show.
      if (location.pathname.startsWith(`/project/${encodeURIComponent(project.project_id)}`)) {
        navigate(routes.list(), { replace: true });
      }
      toast.success(
        released_session_ids.length > 0
          ? `Project deleted; ${released_session_ids.length} chat${released_session_ids.length === 1 ? "" : "s"} kept`
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
            Delete project
          </Button>
        </>
      }
    >
      <p>
        Delete the project <span className="text-basic-primary">&quot;{project?.name}&quot;</span>?
        Its chats are kept and become unassigned, so nothing said in them is lost.
      </p>
    </Modal>
  );
}
