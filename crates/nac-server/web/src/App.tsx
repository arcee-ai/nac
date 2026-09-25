import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { AppShell } from "@/app/components/AppShell";
import { LeftSidebar } from "@/app/components/LeftSidebar";
import DesignPreviewPage from "@/app/components/pages/DesignPreviewPage";
import ProjectRedirectPage from "@/app/components/pages/ProjectRedirectPage";
import ProjectsListPage from "@/app/components/pages/ProjectsListPage";
import SessionPage from "@/app/components/pages/SessionPage";
import { routes } from "@/app/lib/routes";
import { ProjectActionsProvider } from "@/app/providers/ProjectActionsProvider";
import { ManagedHostProvider } from "@/app/features/managed/controller/ManagedHostProvider";
import { SessionActionsProvider } from "@/app/providers/SessionActionsProvider";
import { ToastProvider } from "@/app/providers/ToastProvider";

export function KeyedSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <section className="relative flex h-full min-h-0 overflow-hidden bg-elevation-ground">
      {/* The session page remounts per id so its draft and panel state reset.
          The sidebar stays put, or its open project groups replay their height
          animation on every session click. */}
      <LeftSidebar />
      <SessionPage key={sessionId} />
    </section>
  );
}

export default function App() {
  return (
    <ToastProvider>
      {/* Projects sit outside sessions: deleting a project reaches its chats,
          never the other way round. */}
      <SessionActionsProvider>
        <ProjectActionsProvider>
          <ManagedHostProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/" element={<ProjectsListPage />} />
                <Route path="/project/:projectId" element={<ProjectRedirectPage />} />
                <Route path="/session/:sessionId/:panel?" element={<KeyedSessionPage />} />
              </Route>
              <Route path="/design" element={<DesignPreviewPage />} />
              <Route path="*" element={<Navigate to={routes.list()} replace />} />
            </Routes>
          </ManagedHostProvider>
        </ProjectActionsProvider>
      </SessionActionsProvider>
    </ToastProvider>
  );
}
