import { useContext, useEffect, useMemo, useState } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Navigate, useParams } from "react-router-dom";

import { Loader, LoaderSize } from "@/app/atoms";
import { atomRefresh, readAsync } from "@/app/effect/remote";
import { newestPrimarySessionForProject } from "@/app/lib/projects";
import { routes } from "@/app/lib/routes";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { projectsAtom, SESSIONS_POLL_MS, sessionsAtom } from "@/app/services/queries";

/**
 * One in-flight create per project, so React StrictMode replaying the mount
 * effect cannot POST two chats before the session list refreshes.
 */
const firstChatByProject = new Map<string, Promise<void>>();

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
  const registry = useContext(RegistryContext);
  const projectsQuery = readAsync(useAtomValue(projectsAtom));
  const sessionsQuery = readAsync(useAtomValue(sessionsAtom(SESSIONS_POLL_MS)));
  const [confirmedProjectId, setConfirmedProjectId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const projectsRead = projectsAtom;
    const sessionsRead = sessionsAtom(SESSIONS_POLL_MS);
    void Promise.all([
      atomRefresh.run(registry, projectsRead),
      atomRefresh.run(registry, sessionsRead),
    ])
      .then(() => {
        if (!current) return;
        const projects = registry.get(projectsRead);
        const sessions = registry.get(sessionsRead);
        if (AsyncResult.isSuccess(projects) && AsyncResult.isSuccess(sessions)) {
          setConfirmedProjectId(projectId);
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [projectId, registry]);

  const project = useMemo(
    () => projectsQuery.data?.projects.find((entry) => entry.project_id === projectId) ?? null,
    [projectsQuery.data, projectId],
  );
  const newest = useMemo(
    () => newestPrimarySessionForProject(sessionsQuery.data ?? [], projectId),
    [sessionsQuery.data, projectId],
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

  const startChat = actions.newChat;
  useEffect(() => {
    if (!needsFirstChat) return;
    let pending = firstChatByProject.get(projectId);
    if (!pending) {
      pending = startChat(projectId, true).finally(() => {
        firstChatByProject.delete(projectId);
      });
      firstChatByProject.set(projectId, pending);
    }
  }, [needsFirstChat, startChat, projectId]);

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
