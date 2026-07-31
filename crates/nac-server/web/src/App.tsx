import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/app/components/AppShell";
import DesignPreviewPage from "@/app/components/pages/DesignPreviewPage";
import SessionPage from "@/app/components/pages/SessionPage";
import SessionsListPage from "@/app/components/pages/SessionsListPage";
import { routes } from "@/app/lib/routes";
import { SessionActionsProvider } from "@/app/providers/SessionActionsProvider";
import { ToastProvider } from "@/app/providers/ToastProvider";

export default function App() {
  return (
    <ToastProvider>
      <SessionActionsProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<SessionsListPage />} />
            <Route path="/session/:sessionId" element={<SessionPage />} />
            <Route path="/session/:sessionId/:panel" element={<SessionPage />} />
          </Route>
          <Route path="/design" element={<DesignPreviewPage />} />
          <Route path="*" element={<Navigate to={routes.list()} replace />} />
        </Routes>
      </SessionActionsProvider>
    </ToastProvider>
  );
}
