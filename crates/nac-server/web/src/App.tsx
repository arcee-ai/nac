import { lazy, Suspense } from "react";
import { DesktopVisibility } from "@/app/features/desktop-commands/DesktopVisibility";
import { DesktopCommandOwner } from "@/app/features/desktop-commands/DesktopCommandOwner";
import type { DesktopCommandPort } from "@/app/features/desktop-commands/adapter";
import { ProductNavigationProvider } from "@/app/features/product-context/ProductNavigationProvider";
import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { UiPolicyProvider } from "@/app/features/ui-policy/UiPolicyProvider";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { AppShell } from "@/app/components/AppShell";
import { LeftSidebar } from "@/app/components/LeftSidebar";
import ProjectRedirectPage from "@/app/components/pages/ProjectRedirectPage";
import ProjectsListPage from "@/app/components/pages/ProjectsListPage";
import ProjectTaskSchedulesPage from "@/app/features/heartbeats/fresh/ProjectTaskSchedulesPage";
import SessionPage from "@/app/components/pages/SessionPage";
import { routes } from "@/app/lib/routes";
import { ProjectActionsProvider } from "@/app/providers/ProjectActionsProvider";
import { ManagedHostProvider } from "@/app/features/managed/controller/ManagedHostProvider";
import { SessionActionsProvider } from "@/app/providers/SessionActionsProvider";
import { ToastProvider } from "@/app/providers/ToastProvider";

// Only native presentations with the explicit target capability load the
// notification-response decoder and document/IME/navigation owner.
const DesktopSessionTargetOwner = lazy(() =>
  import("@/app/features/desktop-commands/DesktopSessionTargetOwner").then((module) => ({
    default: module.DesktopSessionTargetOwner,
  })),
);

// The design showcase is a separate user-selected route. Ordinary workspace
// startup does not render it; keep its complete page available on demand.
const DesignPreviewPage = lazy(() =>
  import("@/app/components/pages/DesignPreviewPage").catch(() => ({
    default: () => (
      <p role="alert">The design preview could not be loaded. Reload this page to try again.</p>
    ),
  })),
);

export function KeyedSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <section className="relative flex h-full min-h-0 overflow-hidden bg-elevation-ground">
      {/* The session page remounts per id so its panel and focus state reset.
          Text drafts belong to the runtime and survive this remount.
          The sidebar stays put, or its open project groups replay their height
          animation on every session click. */}
      <LeftSidebar />
      <SessionPage key={sessionId} />
    </section>
  );
}

function DesignRoute() {
  const policy = useUiPolicy();
  return policy.orchestrationEnabled ? (
    <Suspense fallback={<p role="status">Loading design preview…</p>}>
      <DesignPreviewPage />
    </Suspense>
  ) : (
    <Navigate to={routes.list()} replace />
  );
}

export default function App({ desktopCommands }: { desktopCommands?: DesktopCommandPort }) {
  return (
    <DesktopVisibility port={desktopCommands}>
      <UiPolicyProvider>
        <ToastProvider>
          {/* Projects sit outside sessions: deleting a project reaches its chats,
            never the other way round. */}
          <SessionActionsProvider>
            <ProjectActionsProvider>
              <ManagedHostProvider>
                <ProductNavigationProvider>
                  {desktopCommands && <DesktopCommandOwner port={desktopCommands} />}
                  {desktopCommands?.connectSessionTarget && (
                    <Suspense fallback={null}>
                      <DesktopSessionTargetOwner port={desktopCommands} />
                    </Suspense>
                  )}
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route path="/" element={<ProjectsListPage />} />
                      <Route path="/project/:projectId" element={<ProjectRedirectPage />} />
                      <Route
                        path="/project/:projectId/task-schedules"
                        element={<ProjectTaskSchedulesPage />}
                      />
                      <Route path="/task-schedules" element={<ProjectTaskSchedulesPage />} />
                      <Route path="/session/:sessionId/:panel?" element={<KeyedSessionPage />} />
                    </Route>
                    <Route path="/design" element={<DesignRoute />} />
                    <Route path="*" element={<Navigate to={routes.list()} replace />} />
                  </Routes>
                </ProductNavigationProvider>
              </ManagedHostProvider>
            </ProjectActionsProvider>
          </SessionActionsProvider>
        </ToastProvider>
      </UiPolicyProvider>
    </DesktopVisibility>
  );
}
