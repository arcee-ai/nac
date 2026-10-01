import { flushSync } from "react-dom";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button, ButtonContent, ButtonVariant, Modal, ModalSize } from "@/app/atoms";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { parseStoreTime, shortId } from "@/app/lib/format";
import { ClientRequestError } from "@/app/effect/errors";
import { readAsync } from "@/app/effect/remote";
import { toRunError } from "@/app/lib/providerError";
import { routes, sessionIdFromPath } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { deleteSessionAtom, SESSIONS_POLL_MS, sessionsAtom } from "@/app/services/queries";

function commandError(cause: unknown): unknown {
  return cause instanceof ClientRequestError ? cause.error : cause;
}
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
  const remove = useAtomSet(deleteSessionAtom, { mode: "promise" });
  const removing = useAtomValue(deleteSessionAtom).waiting;
  const { data: sessions = [] } = readAsync(useAtomValue(sessionsAtom(SESSIONS_POLL_MS)));

  const submit = async () => {
    if (!summary || removing) return;
    const id = summary.session_id;
    const openPath = location.pathname;
    const leaveOpenSession =
      sessionIdFromPath(openPath) === id ? routeAfterDeletingOpenSession(summary, sessions) : null;
    try {
      // Commit the new route before the cache drops this chat, otherwise the
      // page paints one frame of "unassigned" over the project's remaining tabs.
      if (leaveOpenSession) {
        flushSync(() => {
          navigate(leaveOpenSession, { replace: true });
        });
      }
      await remove(id);
      toast.success("Session deleted");
      onClose();
    } catch (error) {
      if (leaveOpenSession) {
        navigate(openPath, { replace: true });
      }
      toast.error(`Failed to delete: ${errorMessage(toRunError(commandError(error)))}`);
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
            disabled={removing}
          >
            Cancel
          </Button>
          <Button
            variant={ButtonVariant.SecondaryDestructive}
            content={ButtonContent.Text}
            onClick={submit}
            loading={removing}
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
