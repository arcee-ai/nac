import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";

import { Button, ButtonContent, ButtonSize, ButtonVariant, Icon, IconName } from "@/app/atoms";
import { LeftSidebar } from "@/app/components/LeftSidebar";
import { ProjectsEmptyState } from "@/app/components/projects/ProjectsEmptyState";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { SessionListBody, SessionListSwitch } from "@/app/features/inbox/SessionLists";
import { SidebarToggle } from "@/app/features/sidebar/SidebarToggle";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { visibleSessions } from "@/app/features/ui-policy/policy";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { projectListItems } from "@/app/lib/projects";
import { routes } from "@/app/lib/routes";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useProjects, useSessions } from "@/app/services/queries";

import { HomeComposer } from "./HomeComposer";
import { NeedsYouLine } from "./NeedsYouLine";
import { ProjectTiles } from "./ProjectTiles";

function LoadingHome() {
  return (
    <div role="status" aria-label="Loading Home" className="flex w-full flex-col gap-3">
      <div className="h-[132px] w-full animate-pulse rounded-composer bg-[var(--f-wash-1)] motion-reduce:animate-none" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * Home (`/`): the hero composer — the one new-session flow — then what needs
 * the user, what is running, recent sessions and the project tiles. Phones get
 * the same page under the minimal app header; it is the session list there.
 */
export function HomePage() {
  const { trackAttention } = useNativeRuntime().stores.attentionStore;
  const isMobile = useIsMobile();
  const policy = useUiPolicy();
  const managed = useManagedHost();
  const projectActions = useProjectActions();
  const sessionsQuery = useSessions();
  const projectsQuery = useProjects();
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

  const retry = () => {
    void projectsQuery.refetch();
    void sessionsQuery.refetch();
  };

  const intervalTasks = managed.isManaged ? null : (
    <Link
      to={routes.taskSchedules()}
      className="type-label inline-flex min-h-8 items-center gap-1.5 rounded-pill px-2.5 text-basic-tertiary hover:bg-[var(--f-wash-1)] hover:text-basic-primary max-md:min-h-11"
    >
      <Icon iconName={IconName.Clock} size={14} />
      Interval tasks
    </Link>
  );

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
              ) : (
                <HomeComposer projects={projects} sessions={sessions} compact={isMobile} />
              )}
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
                  Couldn't load your sessions: {errorMessage(error)}
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
            {loading ? null : isMobile ? (
              // A phone has no sidebar: its list is here, under the same switch.
              <section
                ref={listRef}
                aria-label="Sessions and Inbox"
                className="flex flex-col gap-3"
              >
                <SessionListSwitch touch />
                <SessionListBody
                  touch
                  projects={projects}
                  sessions={sessions}
                  activeSessionId={null}
                />
                {intervalTasks ? <div className="self-start">{intervalTasks}</div> : null}
              </section>
            ) : (
              <ProjectTiles
                items={items}
                projects={projects}
                sessions={sessions}
                headingTrailing={intervalTasks}
              />
            )}
          </main>
        )}
      </div>
    </div>
  );
}
