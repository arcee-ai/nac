import { Outlet, useLocation } from "react-router-dom";

import { MobileHeader } from "@/app/components/MobileHeader";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { sessionIdFromPath } from "@/app/lib/routes";

/**
 * The app frame. Wide screens have no app bar: each page owns its 52px header
 * (and the sidebar its own). Phones get the minimal header everywhere except a
 * session, whose own header covers the phone, and Settings, which has its own.
 */
export function AppShell() {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const ownHeader = sessionIdFromPath(pathname) !== null || pathname.startsWith("/settings");
  return (
    <div className="flex h-full flex-col bg-elevation-ground text-basic-primary">
      {isMobile && !ownHeader ? <MobileHeader /> : null}
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
