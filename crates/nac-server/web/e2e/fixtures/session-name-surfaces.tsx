// Production components retained for consumers but currently absent from App routes.
import { useLocation } from "react-router-dom";
import { ProjectSessionTabs } from "../../src/app/components/projects/ProjectSessionTabs";
import { SessionCollection } from "../../src/app/components/sessions/SessionCollection";
import { UiPolicyProvider } from "../../src/app/features/ui-policy/UiPolicyProvider";
import { ToastProvider } from "../../src/app/providers/ToastProvider";
import { ProjectActionsProvider } from "../../src/app/providers/ProjectActionsProvider";
import { SessionActionsProvider } from "../../src/app/providers/SessionActionsProvider";
import { useProjects, useVisibleSessions } from "../../src/app/services/queries";

function Surfaces() {
  const { data: sessions = [] } = useVisibleSessions();
  const { data: projects } = useProjects();
  const location = useLocation();
  const id = location.pathname.split("/")[2];
  const active = sessions.find((entry) => entry.summary.session_id === id);
  const projectId = active?.summary.project_id ?? null;
  return (
    <main className="flex h-full min-w-0 flex-col bg-elevation-ground">
      <section aria-label="Retained tab strip" className="min-w-0">
        <ProjectSessionTabs
          projectId={projectId}
          sessions={sessions.filter((entry) => entry.summary.project_id === projectId)}
          activeSessionId={id}
          summary={active?.summary ?? null}
        />
      </section>
      <section
        aria-label="Retained session collection"
        className="flex min-h-0 w-full max-w-[400px] flex-1 flex-col"
      >
        <SessionCollection
          sessions={sessions}
          projects={projects?.projects ?? []}
          activeSessionId={id}
        />
      </section>
    </main>
  );
}
export function SessionNameSurfaces() {
  return (
    <UiPolicyProvider>
      <ToastProvider>
        <SessionActionsProvider>
          <ProjectActionsProvider>
            <Surfaces />
          </ProjectActionsProvider>
        </SessionActionsProvider>
      </ToastProvider>
    </UiPolicyProvider>
  );
}
