import { useLocation, useNavigate } from "react-router-dom";

import { Button, ButtonContent, ButtonVariant, Modal, ModalSize } from "@/app/atoms";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { parseStoreTime, shortId } from "@/app/lib/format";
import { toRunError } from "@/app/lib/providerError";
import { routes, sessionIdFromPath } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useDeleteSession, useSessions } from "@/app/services/queries";
import type { ManagedSessionSummary, SessionSummarySnapshot } from "@/app/types/api";

interface DeleteModalProps {
  open: boolean;
  onClose: () => void;
  summary: SessionSummarySnapshot | null;
}

/** Where to land after deleting the chat currently on screen. */
function routeAfterDeletingOpenSession(
  summary: SessionSummarySnapshot,
  sessions: ManagedSessionSummary[],
): string {
  const projectId = summary.project_id?.trim();
  if (!projectId) return routes.list();
  const siblings = sessions.filter(
    (entry) =>
      entry.summary.project_id === projectId && entry.summary.session_id !== summary.session_id,
  );
  siblings.sort(
    (a, b) => parseStoreTime(b.summary.updated_at) - parseStoreTime(a.summary.updated_at),
  );
  const newest = siblings[0];
  return newest ? routes.session(newest.summary.session_id) : routes.project(projectId);
}

export function DeleteModal({ open, onClose, summary }: DeleteModalProps) {
  const toast = useToast();
  const sessionTitle = useSessionTitle();
  const navigate = useNavigate();
  const location = useLocation();
  const remove = useDeleteSession();
  const { data: sessions = [] } = useSessions();

  const submit = async () => {
    if (!summary || remove.isPending) return;
    const id = summary.session_id;
    try {
      await remove.mutateAsync(id);
      // A deleted session cannot stay on screen. An orphan falls back to the
      // listing; a project chat stays in that project on a sibling, or on
      // `/project/:id` which starts a replacement if it was the last one.
      if (sessionIdFromPath(location.pathname) === id) {
        navigate(routeAfterDeletingOpenSession(summary, sessions), { replace: true });
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
        <span className="text-basic-primary">&quot;{sessionTitle(summary)}&quot;</span>{" "}
        <span className="font-mono text-basic-muted">({shortId(summary?.session_id)})</span>? This
        action cannot be undone.
      </p>
    </Modal>
  );
}
