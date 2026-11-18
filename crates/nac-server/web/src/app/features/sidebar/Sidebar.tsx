import { useSidebarToggleRequests } from "@/app/features/command-palette/paletteSignal";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  KeyboardShortcut,
  Logo,
  Tooltip,
} from "@/app/atoms";
import { TooltipPosition } from "@/app/atoms/tooltip";
import { useSidebarCommands } from "@/app/components/LeftSidebar/useSidebarCommands";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { useCommandSurfaceControls } from "@/app/features/command-palette/paletteSignal";
import { SessionListBody, SessionListSwitch } from "@/app/features/inbox/SessionLists";
import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { cn } from "@/app/lib/cn";
import { routes } from "@/app/lib/routes";
import { MOD } from "@/app/lib/shortcuts";
import { useNewSessionKeys } from "@/app/features/desktop-commands/nativeMenu";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useProjects, useVisibleSessions } from "@/app/services/queries";

import { SIDEBAR_TOGGLE_KEYS, SIDEBAR_WIDTH, useSidebar } from "./useSidebar";

const SEARCH_KEYS = [MOD, "k"];

/** A 32px navigation row at the top of the sidebar. */
function NavRow({
  icon,
  label,
  active = false,
  shortcut,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  shortcut?: string[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "group/nav flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left outline-none",
        "type-label transition-colors duration-150 ease-out motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--f-focus)]",
        active
          ? "bg-[var(--f-wash-2)] text-basic-primary"
          : "text-basic-secondary hover:bg-[var(--f-wash-1)] hover:text-basic-primary",
      )}
    >
      <Icon iconName={icon} size={16} className="shrink-0 text-basic-tertiary" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? (
        <span
          aria-hidden
          className="opacity-0 transition-opacity duration-150 group-hover/nav:opacity-100"
        >
          <KeyboardShortcut keys={shortcut} />
        </span>
      ) : null}
    </button>
  );
}

/** Everything inside the sidebar surface; mode-independent. */
function SidebarBody({ onHide }: { onHide: () => void }) {
  const { openCommandPalette } = useCommandSurfaceControls();
  const commands = useSidebarCommands();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: sessions = [] } = useVisibleSessions();
  const { data: projectList } = useProjects();
  const go = (to: string) => navigate(to);
  const newSessionKeys = useNewSessionKeys();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 52px: the macOS titlebar band. Non-interactive space stays draggable. */}
      <div className="flex h-[52px] shrink-0 items-center justify-between pr-2 pl-4">
        <span className="flex items-center gap-2 text-basic-primary">
          <Logo markOnly height={14} />
          <span className="type-strong tracking-tight">NAC</span>
        </span>
        <Tooltip
          title="Hide sidebar"
          keyboardShortcuts={SIDEBAR_TOGGLE_KEYS}
          position={TooltipPosition.BottomLeft}
          sticky
        >
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Medium}
            content={ButtonContent.Icon}
            aria-label="Hide sidebar"
            onClick={onHide}
          >
            <Icon iconName={IconName.LeftSidebar} />
          </Button>
        </Tooltip>
      </div>

      <nav aria-label="Primary" className="flex shrink-0 flex-col gap-px px-2 pb-2">
        <NavRow
          icon={IconName.Home}
          label="Home"
          active={pathname === routes.list()}
          onClick={() => go(routes.list())}
        />
        <NavRow
          icon={IconName.AddChat}
          label="New session"
          shortcut={newSessionKeys}
          onClick={() => void commands.newSession()}
        />
        <button
          type="button"
          aria-label="Search"
          onClick={() => openCommandPalette()}
          className={cn(
            "my-1 flex h-8 w-full items-center gap-2 rounded-pill border border-tertiary px-3 text-left",
            "bg-elevation-level-1 text-basic-muted outline-none",
            "transition-colors duration-150 ease-out hover:border-secondary hover:text-basic-tertiary",
            "focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
          )}
        >
          <Icon iconName={IconName.Search} size={14} className="shrink-0" />
          <span className="type-body-chrome flex-1">Search</span>
          <span aria-hidden>
            <KeyboardShortcut keys={SEARCH_KEYS} />
          </span>
        </button>
      </nav>

      <div className="shrink-0 px-2 pt-2 pb-1">
        <SessionListSwitch />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-1 pb-3 [scrollbar-gutter:stable]">
        <SessionListBody
          projects={projectList?.projects ?? []}
          sessions={sessions}
          activeSessionId={commands.sessionId}
        />
      </div>

      <div className="flex h-12 shrink-0 items-center justify-between border-t border-muted px-2">
        <Tooltip title="Settings" position={TooltipPosition.TopRight} sticky>
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Medium}
            content={ButtonContent.Icon}
            aria-label="Settings"
            onClick={() => go("/settings")}
          >
            <Icon iconName={IconName.Gear} />
          </Button>
        </Tooltip>
        <ThemeToggle />
      </div>
    </div>
  );
}

function SidebarSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "h-full bg-elevation-level-0-5 border-r border-tertiary text-basic-primary",
        className,
      )}
      style={{ width: SIDEBAR_WIDTH }}
    >
      {children}
    </div>
  );
}

/**
 * The slim Focus sidebar: an in-flow 256px column that hides to nothing
 * (⌘B, "Hide sidebar"). Open by default from 1024px and remembered; closed by
 * default from 768px to 1023px, where it also closes again after navigating.
 * Phones get none (Home is the list there).
 */
export function Sidebar() {
  const { setSidebarOffset } = useNativeRuntime().stores.sidebarLayoutStore;
  const { mode, open, setOpen, toggle } = useSidebar();
  const { pathname } = useLocation();

  useKeyboardShortcuts([
    { keys: SIDEBAR_TOGGLE_KEYS, onTrigger: toggle, enabled: mode !== "none" },
  ]);
  // The palette's "Toggle sidebar" is offered only while a sidebar can answer it.
  useSidebarToggleRequests(mode !== "none" ? toggle : null);

  useLayoutEffect(() => {
    setSidebarOffset(mode !== "none" && open ? SIDEBAR_WIDTH : 0);
  }, [mode, open, setSidebarOffset]);
  useLayoutEffect(() => () => setSidebarOffset(0), [setSidebarOffset]);

  // A narrow window lends the page back once the user has picked a place.
  const narrow = useRef(mode === "narrow");
  useLayoutEffect(() => {
    narrow.current = mode === "narrow";
  });
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = pathname;
    if (narrow.current) setOpen(false);
  }, [pathname, setOpen]);

  if (mode === "none") return null;

  return (
    <div
      data-sidebar="true"
      className="relative h-full shrink-0 overflow-hidden transition-[width] duration-200 motion-reduce:transition-none"
      style={{ width: open ? SIDEBAR_WIDTH : 0, transitionTimingFunction: "var(--ease-drawer)" }}
      inert={!open}
      aria-hidden={!open}
    >
      <SidebarSurface className="absolute inset-y-0 right-0">
        <SidebarBody onHide={() => setOpen(false)} />
      </SidebarSurface>
    </div>
  );
}
