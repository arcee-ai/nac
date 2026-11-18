import { useLocation, useNavigate } from "react-router-dom";

import { Icon, IconName, Modal } from "@/app/atoms";
import { ThemeSegmented } from "@/app/components/ThemeToggle";
import { useCommandSurfaceControls } from "@/app/features/command-palette/paletteSignal";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { SessionListBody, SessionListSwitch } from "@/app/features/inbox/SessionLists";
import { cn } from "@/app/lib/cn";
import { routes } from "@/app/lib/routes";
import { useProjects, useVisibleSessions } from "@/app/services/queries";

import { useSidebarCommands } from "./useSidebarCommands";

function MenuRow({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "type-label flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left !text-md outline-none",
        "transition-colors duration-150 ease-out active:bg-[var(--f-wash-2)]",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--f-focus)]",
        active ? "bg-[var(--f-wash-2)] text-basic-primary" : "text-basic-primary",
      )}
    >
      <Icon iconName={icon} size={18} className="shrink-0 text-basic-tertiary" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/**
 * The phone's navigation sheet: the sidebar's destinations, theme, and the
 * same session list (44px rows, actions always visible).
 */
export function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { openCommandPalette } = useCommandSurfaceControls();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const commands = useSidebarCommands();
  const managed = useManagedHost();
  const { data: sessions = [] } = useVisibleSessions();
  const { data: projectList } = useProjects();

  const closeAnd = (run: () => void) => () => {
    onClose();
    run();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Menu"
      inertOnPhone
      bodyClassName="scroll-py-4 p-0 [&>*]:shrink-0"
    >
      <nav aria-label="Menu" className="flex flex-col gap-px border-b border-muted px-2 py-2">
        <MenuRow
          icon={IconName.Home}
          label="Home"
          active={pathname === routes.list()}
          onClick={closeAnd(() => navigate(routes.list()))}
        />
        <MenuRow
          icon={IconName.AddChat}
          label="New session"
          onClick={closeAnd(() => void commands.newSession())}
        />
        <MenuRow icon={IconName.Search} label="Search" onClick={closeAnd(openCommandPalette)} />
        <MenuRow
          icon={IconName.Add}
          label={commands.createLabel === "New Project" ? "Add project" : commands.createLabel}
          onClick={closeAnd(commands.newProject)}
        />
        {managed.isManaged ? null : (
          <MenuRow
            icon={IconName.Clock}
            label="Interval tasks"
            onClick={closeAnd(() => navigate(routes.taskSchedules()))}
          />
        )}
        <MenuRow
          icon={IconName.Gear}
          label="Settings"
          onClick={closeAnd(() => navigate("/settings"))}
        />
        <div className="flex min-h-11 items-center justify-between gap-3 px-3">
          <span className="type-label !text-md text-basic-primary">Theme</span>
          <ThemeSegmented />
        </div>
      </nav>
      <div className="px-2 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))]">
        <div className="pb-2">
          <SessionListSwitch touch />
        </div>
        <SessionListBody
          touch
          projects={projectList?.projects ?? []}
          sessions={sessions}
          activeSessionId={commands.sessionId}
          onNavigate={onClose}
        />
      </div>
    </Modal>
  );
}
