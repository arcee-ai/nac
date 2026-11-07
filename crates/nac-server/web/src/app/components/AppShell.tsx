import { Outlet } from "react-router-dom";

import { TopBar } from "@/app/components/TopBar";

/** Phone chrome reserves its height; wide chrome floats over the page-owned scroll. */
export function AppShell() {
  return (
    <div className="h-full flex flex-col bg-elevation-ground text-basic-primary">
      <TopBar />
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
