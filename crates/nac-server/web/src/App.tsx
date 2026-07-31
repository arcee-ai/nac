import { Navigate, Route, Routes } from "react-router-dom";

import DesignPreviewPage from "@/app/components/pages/DesignPreviewPage";
import SessionPage from "@/app/components/pages/SessionPage";
import SessionsListPage from "@/app/components/pages/SessionsListPage";
import { routes } from "@/app/lib/routes";

export default function App() {
  return (
    <div className="min-h-full bg-elevation-ground text-basic-primary">
      <Routes>
        <Route path="/" element={<SessionsListPage />} />
        <Route path="/session/:sessionId" element={<SessionPage />} />
        <Route path="/session/:sessionId/:tab" element={<SessionPage />} />
        <Route path="/design" element={<DesignPreviewPage />} />
        <Route path="*" element={<Navigate to={routes.list()} replace />} />
      </Routes>
    </div>
  );
}
