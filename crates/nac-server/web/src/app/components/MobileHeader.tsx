import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Icon, IconName, Logo } from "@/app/atoms";
import { MobileMenu } from "@/app/components/LeftSidebar/MobileMenu";
import { useCommandSurfaceControls } from "@/app/features/command-palette/paletteSignal";
import { cn } from "@/app/lib/cn";
import { routes } from "@/app/lib/routes";

function titleFor(pathname: string): string {
  if (pathname === routes.list()) return "Home";
  if (pathname.endsWith("/task-schedules")) return "Interval tasks";
  return "";
}

const TARGET = cn(
  "inline-flex size-11 shrink-0 items-center justify-center rounded-pill text-basic-secondary outline-none",
  "transition-colors duration-150 ease-out active:bg-[var(--f-wash-2)] hover:bg-[var(--f-wash-1)]",
  "focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
);

/**
 * The phone's app header outside a session: the NAC mark (Home), the page
 * title, Search (the ⌘K palette) and the menu. A session's own header
 * replaces it there.
 */
export function MobileHeader() {
  const { openCommandPalette } = useCommandSurfaceControls();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <header className="relative z-10 flex w-full min-w-0 shrink-0 items-center gap-1 px-2 pt-[max(4px,env(safe-area-inset-top))] pb-1">
        <button
          type="button"
          aria-label="Home"
          className={cn(TARGET, "text-basic-primary")}
          onClick={() => navigate(routes.list())}
        >
          <Logo markOnly height={16} />
        </button>
        <p className="type-heading min-w-0 flex-1 truncate text-basic-primary">
          {titleFor(pathname)}
        </p>
        <button
          type="button"
          aria-label="Search"
          className={TARGET}
          onClick={() => openCommandPalette()}
        >
          <Icon iconName={IconName.Search} size={20} />
        </button>
        <button
          type="button"
          aria-label="Open the menu"
          aria-expanded={menuOpen}
          className={TARGET}
          onClick={() => setMenuOpen(true)}
        >
          <Icon iconName={IconName.Hamburger} size={20} />
        </button>
      </header>
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
