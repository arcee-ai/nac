import { Link } from "react-router-dom";
import { routes } from "@/app/lib/routes";
import type { ToolPresentation } from "@/app/lib/toolPresentation";
import { useSessions } from "@/app/services/queries/session";
import { useTranscriptSessionId } from "./transcriptTurns";

type Task = NonNullable<ToolPresentation["launchedTask"]>;
type Candidate = { key: string; groupId: string; task: Task };

/** Receipt-only navigation: an authenticated passive inventory must confirm the identity. */
export function NativeTaskLink({ task }: { task: Task }) {
  return <NativeTaskLinks candidates={[{ key: task.sessionId, groupId: "", task }]} />;
}

/** Validate every receipt before allowing it to suppress another in the same group. */
export function NativeTaskLinks({ candidates }: { candidates: Candidate[] }) {
  const caller = useTranscriptSessionId();
  // The sidebar shares this passive inventory. This observer neither polls nor attaches a target.
  const sessions = useSessions(0);
  const seen = new Map<string, Set<string>>();
  const links = candidates.flatMap(({ key, groupId, task }) => {
    if (caller !== task.callerId) return [];
    const known = sessions.data?.find(
      ({ summary, lineage }) =>
        summary.session_id === task.sessionId &&
        summary.project_id === task.projectId &&
        summary.behavior === "direct" &&
        lineage == null,
    );
    if (!known) return [];
    const group = seen.get(groupId) ?? new Set<string>();
    if (group.has(known.summary.session_id)) return [];
    group.add(known.summary.session_id);
    seen.set(groupId, group);
    return [
      <Link
        key={key}
        className="label-small text-accent-primary"
        to={routes.session(known.summary.session_id)}
      >
        Open separate task: {known.summary.title || task.title}
      </Link>,
    ];
  });
  return links;
}
