import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { visibleSessions } from "@/app/features/ui-policy/policy";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

import { Loader, LoaderSize } from "@/app/atoms";
import { newestPrimarySessionForProject } from "@/app/lib/projects";
import { routes } from "@/app/lib/routes";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useProjects, useSessions } from "@/app/services/queries";

/**
 * `/project/:id` is an address for a project, but every screen that shows one is
 * really a session inside it, so this lands on the project's newest session.
 *
 * A project with no sessions yet opens Home's composer pointed at it (the one
 * new-session flow), replacing this entry so Back does not bounce here.
 */
export default function ProjectRedirectPage() {
  const { projectId = "" } = useParams();
  const actions = useProjectActions();
  const policy = useUiPolicy();
  const projectsQuery = useProjects();
  const sessionsQuery = useSessions();
  const [confirmedProjectId, setConfirmedProjectId] = useState<string | null>(null);

  const refetchProjects = projectsQuery.refetch;
  const refetchSessions = sessionsQuery.refetch;
  useEffect(() => {
    let current = true;
    void Promise.all([refetchProjects(), refetchSessions()])
      .then(([projects, sessions]) => {
        if (current && projects.isSuccess && sessions.isSuccess) {
          setConfirmedProjectId(projectId);
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [projectId, refetchProjects, refetchSessions]);

  const project = useMemo(
    () => projectsQuery.data?.projects.find((entry) => entry.project_id === projectId) ?? null,
    [projectsQuery.data, projectId],
  );
  const newest = useMemo(
    () =>
      newestPrimarySessionForProject(visibleSessions(policy, sessionsQuery.data ?? []), projectId),
    [sessionsQuery.data, projectId, policy],
  );

  const loading = projectsQuery.isLoading || sessionsQuery.isLoading;
  const refreshing = projectsQuery.isFetching || sessionsQuery.isFetching;
  const unavailable = projectsQuery.isError || sessionsQuery.isError;
  const ownershipLoaded = projectsQuery.isSuccess && sessionsQuery.isSuccess;
  const needsFirstChat =
    confirmedProjectId === projectId &&
    !loading &&
    !refreshing &&
    !unavailable &&
    ownershipLoaded &&
    project != null &&
    newest == null;

  const startSession = actions.newChat;
  useEffect(() => {
    if (needsFirstChat) void startSession(projectId, true);
  }, [needsFirstChat, startSession, projectId]);

  // Deleted, or a stale link — the listing is the only honest place to land.
  const ownershipConfirmed = confirmedProjectId === projectId;
  if (ownershipConfirmed && !loading && !project) return <Navigate to={routes.list()} replace />;
  if (ownershipConfirmed && newest)
    return <Navigate to={routes.session(newest.summary.session_id)} replace />;

  return (
    <div className="flex h-full items-center justify-center">
      <Loader size={LoaderSize.Large} />
    </div>
  );
}
