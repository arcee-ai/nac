import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button, ButtonContent, ButtonVariant, Modal, ModalSize } from "@/app/atoms";
import { ClientRequestError } from "@/app/effect/errors";
import { toRunError } from "@/app/lib/providerError";
import { routes, sessionIdFromPath } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { deleteProjectAtom } from "@/app/services/queries";

function commandError(cause: unknown): unknown {
  return cause instanceof ClientRequestError ? cause.error : cause;
}
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
  const remove = useAtomSet(deleteProjectAtom, { mode: "promise" });
  const removing = useAtomValue(deleteProjectAtom).waiting;
  const isMobile = useIsMobile();
  const submit = async (sessions: DeleteProjectSessions) => {
    if (!project || removing) return;
    try {
      const result = await remove({
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
          ? `Project and ${deleted} ${plural(deleted)} removed`
          : kept > 0
            ? `Project removed; ${kept} ${plural(kept)} kept`
            : "Project removed",
      );
      onClose();
    } catch (error) {
      toast.error(`Failed to delete: ${errorMessage(toRunError(commandError(error)))}`);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Remove Project?"
      size={ModalSize.Medium}
      footer={
        <>
          {!isMobile && (
            <Button
              variant={ButtonVariant.Tertiary}
              content={ButtonContent.Text}
              onClick={onClose}
              disabled={removing}
            >
              Cancel
            </Button>
          )}
          <Button
            variant={ButtonVariant.Secondary}
            content={ButtonContent.Text}
            onClick={() => void submit("keep")}
            disabled={removing}
          >
            Keep Sessions
          </Button>
          <Button
            variant={ButtonVariant.SecondaryDestructive}
            content={ButtonContent.Text}
            onClick={() => void submit("delete")}
            loading={removing}
          >
            Remove Project and Sessions
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p>
          Remove <span className="text-basic-primary">&quot;{project?.name}&quot;</span> from NAC?
        </p>
        <p>
          Files at <code className="break-all text-basic-primary">{project?.cwd}</code> will be
          preserved. Select Keep Sessions to leave its chats unassigned, or remove the Project and
          its chats together.
        </p>
      </div>
    </Modal>
  );
}
