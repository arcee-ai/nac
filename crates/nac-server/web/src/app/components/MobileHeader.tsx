import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CodeChangesBadge,
  Icon,
  IconName,
  Logo,
  StickyButton,
} from "@/app/atoms";
import { MobileMenu } from "@/app/components/LeftSidebar/MobileMenu";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { cn } from "@/app/lib/cn";
import { routes, sessionIdFromPath } from "@/app/lib/routes";
import {
  useSessionSnapshot,
  useSessionSummary,
  useVisibleSessions,
  useWorkspaceRevisionChanges,
} from "@/app/services/queries";

/**
 * The phone's only bar: home, what is on screen, then the side panel and the
 * menu that stands in for the desktop sidebar.
 */
export function MobileHeader() {
  const { openSidePanelList } = useNativeRuntime().stores.sessionLayoutStore;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const sessionId = sessionIdFromPath(pathname);

  return (
    <>
      <header className="fade-from-top fixed inset-x-0 top-0 z-10 flex items-center gap-4 p-2">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <StickyButton
            content={ButtonContent.Icon}
            className="shrink-0"
            aria-label="All projects"
            onClick={() => navigate(routes.list())}
          >
            <Logo markOnly height={24} className="icon" />
          </StickyButton>
          {sessionId ? (
            <SessionHeading sessionId={sessionId} />
          ) : (
            <p className="header-md min-w-0 flex-1 truncate text-basic-primary">All Projects</p>
          )}
        </div>
        {sessionId ? (
          <StickyButton
            content={ButtonContent.Icon}
            className="shrink-0"
            aria-label="Open panel"
            onClick={() => openSidePanelList()}
          >
            <Icon iconName={IconName.OpenMobileModal} />
          </StickyButton>
        ) : null}
        <StickyButton
          content={ButtonContent.Icon}
          className="shrink-0"
          aria-label="Open the menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <Icon iconName={IconName.MenuVertical} />
        </StickyButton>
      </header>
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

/** Title over the checkout; a delegated chat leads with a link up to its parent. */
function SessionHeading({ sessionId }: { sessionId: string }) {
  const { useRunning } = useNativeRuntime().stores.runtimeStore;
  const { useSelectedRevision } = useNativeRuntime().stores.sessionLayoutStore;
  const navigate = useNavigate();
  const sessionTitle = useSessionTitle();
  // The page keeps this snapshot fresh; the bar only reads it.
  const { data: snapshot = null } = useSessionSnapshot(sessionId, { enabled: false });
  const { data: entry = null } = useSessionSummary(sessionId);
  const { data: sessions = [] } = useVisibleSessions();
  const running = useRunning(sessionId);
  const selectedRevision = useSelectedRevision();
  const changes = useWorkspaceRevisionChanges(sessionId, selectedRevision);

  const workspace = snapshot?.workspace ?? null;
  const totals =
    selectedRevision == null
      ? workspace
      : (changes.data ?? { total_additions: 0, total_deletions: 0 });
  const additions = totals?.total_additions ?? 0;
  const deletions = totals?.total_deletions ?? 0;
  const repo = workspace?.repo_label ?? workspace?.workspace_display ?? null;
  const lineage = entry?.lineage ?? snapshot?.lineage ?? null;
  const parent = lineage
    ? sessions.find((item) => item.summary.session_id === lineage.parent_session_id)
    : undefined;
  const parentTitle = parent ? sessionTitle(parent.summary) : "Parent session";

  const title = (
    <p
      className={cn(
        "header-sm min-w-0 flex-1 truncate",
        running ? "text-shimmer-basic" : "text-btn-secondary-pressed",
      )}
    >
      {sessionTitle(entry?.summary)}
    </p>
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {lineage ? (
        <div className="flex w-full items-center gap-1">
          <Button
            variant={ButtonVariant.Tertiary}
            size={ButtonSize.Medium}
            className="min-w-0 max-w-16 shrink-0"
            aria-label={`${parentTitle}, parent chat`}
            title={parentTitle}
            onClick={() => navigate(routes.session(lineage.parent_session_id, "delegated"))}
          >
            <span className="truncate underline">{parentTitle}</span>
          </Button>
          <Icon
            iconName={IconName.Right}
            size={16}
            color="var(--color-fill-basic-tertiary)"
            className="shrink-0"
          />
          {title}
        </div>
      ) : (
        <div className="flex w-full">{title}</div>
      )}
      {repo || additions || deletions ? (
        <div className="flex w-full min-w-0 items-center gap-4 overflow-clip rounded-[4px]">
          {repo ? (
            <span className="label-micro min-w-0 truncate text-btn-secondary">{repo}</span>
          ) : null}
          {additions || deletions ? (
            <CodeChangesBadge additions={additions} deletions={deletions} className="shrink-0" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
