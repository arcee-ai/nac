import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { AppShell } from "@/app/components/AppShell";
import DesignPreviewPage from "@/app/components/pages/DesignPreviewPage";
import ProjectRedirectPage from "@/app/components/pages/ProjectRedirectPage";
import ProjectsListPage from "@/app/components/pages/ProjectsListPage";
import SessionPage from "@/app/components/pages/SessionPage";
import { routes } from "@/app/lib/routes";
import { ProjectActionsProvider } from "@/app/providers/ProjectActionsProvider";
import { SessionActionsProvider } from "@/app/providers/SessionActionsProvider";
import { ToastProvider } from "@/app/providers/ToastProvider";

export function KeyedSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <SessionPage key={sessionId} />;
}

export default function App() {
  return (
    <ToastProvider>
      {/* Projects sit outside sessions: deleting a project reaches its chats,
          never the other way round. */}
      <SessionActionsProvider>
        <ProjectActionsProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<ProjectsListPage />} />
              <Route path="/project/:projectId" element={<ProjectRedirectPage />} />
              <Route path="/session/:sessionId" element={<KeyedSessionPage />} />
              <Route path="/session/:sessionId/:panel" element={<KeyedSessionPage />} />
            </Route>
            <Route path="/design" element={<DesignPreviewPage />} />
            <Route path="*" element={<Navigate to={routes.list()} replace />} />
          </Routes>
        </ProjectActionsProvider>
      </SessionActionsProvider>
    </ToastProvider>
  );
}
