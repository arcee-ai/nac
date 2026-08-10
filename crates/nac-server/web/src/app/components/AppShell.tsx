import { Outlet } from "react-router-dom";

import { TopBar } from "@/app/components/TopBar";

/** Fixed top bar over a single scrolling region owned by the active page. */
export function AppShell() {
  return (
    <div className="h-screen flex flex-col bg-elevation-ground text-basic-primary">
      <TopBar />
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
