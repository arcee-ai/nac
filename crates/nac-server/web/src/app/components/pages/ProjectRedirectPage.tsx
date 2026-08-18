import { useEffect, useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";

import { Loader, LoaderSize } from "@/app/atoms";
import { parseStoreTime } from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useProjects, useSessions } from "@/app/services/queries";

/**
 * `/project/:id` is an address for a project, but every screen that shows one is
 * really a chat inside it, so this lands on the project's newest chat.
 *
 * A project with no chats yet starts one instead — which is also what happens
 * right after it is created.
 */
export default function ProjectRedirectPage() {
  const { projectId = "" } = useParams();
  const actions = useProjectActions();
  const projectsQuery = useProjects();
  const sessionsQuery = useSessions();

  const project = useMemo(
    () => projectsQuery.data?.projects.find((entry) => entry.project_id === projectId) ?? null,
    [projectsQuery.data, projectId],
  );
  const newest = useMemo(() => {
    const owned = (sessionsQuery.data ?? []).filter(
      (entry) => entry.summary.project_id === projectId,
    );
    owned.sort(
      (a, b) => parseStoreTime(b.summary.updated_at) - parseStoreTime(a.summary.updated_at),
    );
    return owned[0] ?? null;
  }, [sessionsQuery.data, projectId]);

  const loading = projectsQuery.isLoading || sessionsQuery.isLoading;
  const needsFirstChat = !loading && project != null && newest == null;

  const startChat = actions.newChat;
  useEffect(() => {
    if (needsFirstChat) void startChat(projectId);
  }, [needsFirstChat, startChat, projectId]);

  // Deleted, or a stale link — the listing is the only honest place to land.
  if (!loading && !project) return <Navigate to={routes.list()} replace />;
  if (newest) return <Navigate to={routes.session(newest.summary.session_id)} replace />;

  return (
    <div className="flex h-full items-center justify-center">
      <Loader size={LoaderSize.Large} />
    </div>
  );
}
