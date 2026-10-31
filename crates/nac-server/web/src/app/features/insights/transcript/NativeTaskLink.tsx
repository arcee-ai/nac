import { Link } from "react-router-dom";
import { routes } from "@/app/lib/routes";
import type { ToolPresentation } from "@/app/lib/toolPresentation";
import { useSessions } from "@/app/services/queries/session";
import { useTranscriptSessionId } from "./transcriptTurns";

/** Receipt-only navigation: an authenticated passive inventory must confirm the identity. */
export function NativeTaskLink({ task }: { task: NonNullable<ToolPresentation["launchedTask"]> }) {
  const caller = useTranscriptSessionId();
  // The sidebar shares this passive inventory. This observer neither polls nor attaches a target.
  const sessions = useSessions(0);
  const known = sessions.data?.find(
    ({ summary, lineage }) =>
      summary.session_id === task.sessionId &&
      summary.project_id === task.projectId &&
      summary.behavior === "direct" &&
      lineage == null,
  );
  if (caller !== task.callerId || !known) return null;
  return (
    <Link className="label-small text-accent-primary" to={routes.session(known.summary.session_id)}>
      Open separate task: {known.summary.title || task.title}
    </Link>
  );
}
