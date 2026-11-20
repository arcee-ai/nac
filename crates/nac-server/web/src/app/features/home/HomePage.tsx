import { useEffect, useMemo, useRef, useState } from "react";

import { Button, ButtonContent, ButtonSize, ButtonVariant } from "@/app/atoms";
import { LeftSidebar } from "@/app/components/LeftSidebar";
import { ProjectsEmptyState } from "@/app/components/projects/ProjectsEmptyState";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { SessionListBody, SessionListSwitch } from "@/app/features/inbox/SessionLists";
import { useSetupLifetime } from "@/app/features/setup/lifetime";
import { SidebarToggle } from "@/app/features/sidebar/SidebarToggle";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { visibleSessions } from "@/app/features/ui-policy/policy";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { projectListItems } from "@/app/lib/projects";
import { toRunError } from "@/app/lib/providerError";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useCreateProject, useProjects, useSessions, useStoreInfo } from "@/app/services/queries";

import { AddProjectAction } from "./AddProjectAction";
import { HomeComposer } from "./HomeComposer";
import { NeedsYouLine } from "./NeedsYouLine";

function LoadingHome() {
  return (
    <div role="status" aria-label="Loading Home" className="flex w-full flex-col gap-3">
      <div className="h-[132px] w-full animate-pulse rounded-composer bg-[var(--f-wash-1)] motion-reduce:animate-none" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * Home (`/`): the hero composer — the one new-session flow — and what needs the
 * user. Projects and sessions live in the sidebar. Phones get the same page
 * under the minimal app header, with the session list below it.
 */
export function HomePage() {
  const { trackAttention } = useNativeRuntime().stores.attentionStore;
  const isMobile = useIsMobile();
  const policy = useUiPolicy();
  const managed = useManagedHost();
  const projectActions = useProjectActions();
  const sessionsQuery = useSessions();
  const projectsQuery = useProjects();
  const { data: storeInfo } = useStoreInfo();
  const createProject = useCreateProject();
  const launchProjectLifetime = useSetupLifetime();
  const creatingLaunchProject = useRef(false);
  const [launchProjectError, setLaunchProjectError] = useState<string | null>(null);
  const sessions = useMemo(
    () => visibleSessions(policy, sessionsQuery.data ?? []),
    [sessionsQuery.data, policy],
  );
  const projects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data]);
  const items = useMemo(() => projectListItems(projects, sessions), [projects, sessions]);
  const listRef = useRef<HTMLElement>(null);

  const data = sessionsQuery.data;
  useEffect(() => {
    if (data) trackAttention(data, null);
  }, [data, trackAttention]);

  const loading = projectsQuery.isPending || sessionsQuery.isPending;
  const error = projectsQuery.error ?? sessionsQuery.error;
  const empty = !loading && !error && items.length === 0;
  // Without the project list, neither "no projects" nor a project choice is true.
  const projectsKnown = !loading && !projectsQuery.error;
  const launchFolder = managed.isUnmanaged ? storeInfo?.root_cwd : undefined;
  const chooseLaunchFolder = async () => {
    const lease = launchProjectLifetime.current;
    if (!lease?.current() || !launchFolder || creatingLaunchProject.current) return;
    creatingLaunchProject.current = true;
    setLaunchProjectError(null);
    try {
      const project = await createProject.mutateAsync({ cwd: launchFolder });
      if (lease.current()) await projectActions.newChat(project.project_id);
    } catch (cause) {
      if (lease.current()) setLaunchProjectError(errorMessage(toRunError(cause)));
    } finally {
      creatingLaunchProject.current = false;
    }
  };

  const retry = () => {
    void projectsQuery.refetch();
    void sessionsQuery.refetch();
  };

  return (
    <div className="flex h-full min-h-0 bg-elevation-ground">
      <LeftSidebar variant="projects" />
      <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
        {isMobile ? null : (
          <div className="sticky top-0 z-[2] flex h-[52px] items-center px-3">
            <SidebarToggle />
          </div>
        )}
        {empty ? (
          <ProjectsEmptyState
            mobile={isMobile}
            onStart={projectActions.create}
            launchFolder={launchFolder}
            launchFolderPending={createProject.isPending}
            launchFolderError={launchProjectError}
            onUseLaunchFolder={() => void chooseLaunchFolder()}
            onAddRepository={managed.isManaged ? managed.addRepository : undefined}
            onManagedSettings={managed.isManaged ? managed.openSettings : undefined}
            modelReady={managed.status?.model_ready}
            githubConnected={managed.status?.github_status === "connected"}
          />
        ) : (
          <main
            className={cn(
              "mx-auto flex w-full max-w-[760px] flex-col",
              isMobile
                ? "gap-7 px-4 pt-2 pb-[calc(32px+env(safe-area-inset-bottom))]"
                : "gap-12 px-6 pb-20",
            )}
          >
            <section
              aria-label="New session"
              className={cn(
                "flex flex-col items-center",
                isMobile ? "gap-4" : "gap-6 pt-[max(48px,calc(18vh-52px))]",
              )}
            >
              <h1
                className={cn(
                  "text-center text-basic-primary",
                  isMobile ? "type-title self-start" : "type-display",
                )}
              >
                What should we work on?
              </h1>
              {loading ? (
                <LoadingHome />
              ) : projectsKnown ? (
                <HomeComposer projects={projects} sessions={sessions} compact={isMobile} />
              ) : null}
              <NeedsYouLine
                onShowList={
                  isMobile
                    ? () => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                    : undefined
                }
              />
            </section>
            {error ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-card border border-[var(--f-red-line)] bg-[var(--f-red-wash)] px-4 py-3"
              >
                <span className="type-body-chrome text-[var(--f-red-text)]">
                  Couldn't load your {projectsQuery.error ? "projects" : "sessions"}:{" "}
                  {errorMessage(error)}
                </span>
                <Button
                  variant={ButtonVariant.Secondary}
                  size={ButtonSize.Small}
                  content={ButtonContent.Text}
                  onClick={retry}
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {projectsKnown && isMobile ? (
              // A phone has no sidebar: its list is here, under the same switch.
              <section
                ref={listRef}
                aria-label="Sessions and Inbox"
                className="flex flex-col gap-3"
              >
                <div className="self-start">
                  <AddProjectAction touch />
                </div>
                <SessionListSwitch touch />
                <SessionListBody
                  touch
                  projects={projects}
                  sessions={sessions}
                  activeSessionId={null}
                />
              </section>
            ) : null}
          </main>
        )}
      </div>
    </div>
  );
}
