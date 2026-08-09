import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  HorizontalTabsItem,
  HorizontalTabsItemVariant,
  Icon,
  IconName,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { BranchPicker } from "@/app/components/inspector/BranchPicker";
import { FilesView } from "@/app/components/inspector/FilesView";
import { HistoryView } from "@/app/components/inspector/HistoryView";
import { RevisionPicker } from "@/app/components/inspector/RevisionPicker";
import { ThreadsView } from "@/app/components/inspector/ThreadsView";
import { WorksetsView } from "@/app/components/inspector/WorksetsView";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import {
  DEFAULT_SESSION_PANEL,
  SESSION_PANEL_LABEL,
  WIDE_SESSION_PANELS,
  type SessionPanel,
} from "@/app/lib/routes";
import { cn } from "@/app/lib/cn";
import { useWorkspaceRevisionChanges } from "@/app/services/queries";
import {
  selectRevision,
  selectThread,
  selectWorkset,
  showSidePanelList,
  toggleSidePanelCollapsed,
  toggleSidePanelExpanded,
  useSelectedRevision,
  useSelectedThread,
  useSelectedWorkset,
  useSidePanelExpanded,
} from "@/app/store/sessionLayoutStore";
import type {
  SessionSnapshotResponse,
  WorkspaceSnapshot,
} from "@/app/types/api";

interface SessionSideBoxProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  panel: SessionPanel;
  onPanelChange: (panel: SessionPanel) => void;
}

function FooterChip({
  iconName,
  label,
  compact = false,
}: {
  iconName: IconName;
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-[6px] shrink-0 min-w-0 py-1 rounded-[4px]",
        compact ? "pl-1 pr-1" : "pl-1 pr-3",
      )}
    >
      <Icon
        iconName={iconName}
        size={16}
        color="var(--color-fill-basic-tertiary)"
      />
      <span
        className={cn(
          "label-micro text-basic-tertiary truncate",
          compact ? "max-w-[64px]" : "max-w-[128px]",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/** Repo, branch, snapshot and the diff total, mirroring the Figma box footer. */
function SideBoxFooter({
  sessionId,
  workspace,
  revision,
  compact,
}: {
  sessionId: string;
  workspace: WorkspaceSnapshot | null;
  revision: number | null;
  /** Phone width: the chips give up room so the diff total stays visible. */
  compact: boolean;
}) {
  const repo = workspace?.repo_label ?? workspace?.workspace_display ?? null;
  const branch = workspace?.branch ?? null;
  // A revision reports its own totals, which the panel has already fetched.
  const changes = useWorkspaceRevisionChanges(sessionId, revision);
  const totals =
    revision == null
      ? workspace
      : (changes.data ?? { total_additions: 0, total_deletions: 0 });
  const additions = totals?.total_additions ?? 0;
  const deletions = totals?.total_deletions ?? 0;

  return (
    <div
      className={cn(
        "flex h-10 items-center gap-[10px] shrink-0 border-t border-muted bg-elevation-level-1",
        compact ? "px-2 gap-1" : "px-4",
      )}
    >
      <div
        className={cn(
          "flex flex-1 min-w-0 items-center",
          compact ? "gap-1" : "gap-[10px]",
        )}
      >
        {repo ? (
          <FooterChip
            iconName={IconName.Folder}
            label={repo}
            compact={compact}
          />
        ) : null}
        {branch ? <BranchPicker sessionId={sessionId} branch={branch} /> : null}
        <RevisionPicker
          sessionId={sessionId}
          selected={revision}
          onSelect={selectRevision}
        />
      </div>
      {additions || deletions ? (
        <div className="flex items-center gap-2 shrink-0 code code-small">
          <span className="text-success-primary">+{additions}</span>
          <span className="text-error-primary">-{deletions}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The left half of the session screen: one box with the Threads / Files /
 * Worksets panels, sized by the shared layout store. On a phone the panels are
 * the body of the modal box that SessionPage puts them in, and its chrome —
 * header, bottom bar — belongs to the dialog rather than to this box.
 */
export function SessionSideBox({
  sessionId,
  snapshot,
  panel,
  onPanelChange,
}: SessionSideBoxProps) {
  const expanded = useSidePanelExpanded();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const selectedThread = useSelectedThread();
  const selectedWorkset = useSelectedWorkset();
  const selectedRevision = useSelectedRevision();

  // History belongs to the phone's bottom bar: a wide box reaches revisions
  // through its footer chip, so a link to that panel lands on the default one.
  const active =
    !isMobile && panel === "history" ? DEFAULT_SESSION_PANEL : panel;

  const body = (
    <>
      {active === "files" ? (
        <FilesView
          sessionId={sessionId}
          snapshot={snapshot}
          revision={selectedRevision}
        />
      ) : null}
      {active === "worksets" ? (
        <WorksetsView
          snapshot={snapshot}
          selected={selectedWorkset}
          onSelect={selectWorkset}
        />
      ) : null}
      {active === "threads" ? (
        <ThreadsView
          snapshot={snapshot}
          selected={selectedThread}
          onSelect={selectThread}
        />
      ) : null}
      {active === "history" ? (
        <HistoryView
          sessionId={sessionId}
          selected={selectedRevision}
          onSelect={selectRevision}
        />
      ) : null}
    </>
  );

  if (isMobile) {
    return <div className="flex flex-col flex-1 min-h-0">{body}</div>;
  }

  return (
    <div className="flex flex-col min-h-0 h-full rounded-[8px] overflow-hidden bg-elevation-level-1 shadow-md border border-muted">
      <div
        className={cn(
          "flex items-center gap-4 pl-1 pt-1 shrink-0 border-b border-muted bg-elevation-level-1",
          // Room for the Modal's Close when this box is the fullscreen body.
          expanded ? "pr-10" : "pr-2",
        )}
      >
        <div className="flex flex-1 min-w-0 items-center gap-1" role="tablist">
          {WIDE_SESSION_PANELS.map((name) => (
            <HorizontalTabsItem
              key={name}
              role="tab"
              aria-selected={active === name}
              active={active === name}
              variant={HorizontalTabsItemVariant.Neutral}
              onClick={() => {
                // A tablet shows one column at a time, and a new panel opens on
                // its selected row; a desktop split ignores the flag entirely.
                showSidePanelList(false);
                onPanelChange(name);
              }}
            >
              {SESSION_PANEL_LABEL[name]}
            </HorizontalTabsItem>
          ))}
        </div>
        {/* Expand/hide live here in the split; once fullscreen the Modal owns
            Close. */}
        {expanded ? null : (
          <div className="flex items-center gap-2 pb-[2px] shrink-0">
            <Tooltip title="Expand panel" position={TooltipPosition.BottomLeft}>
              <Button
                size={ButtonSize.Medium}
                variant={ButtonVariant.Ghost}
                content={ButtonContent.Icon}
                aria-label="Expand panel"
                onClick={toggleSidePanelExpanded}
              >
                <Icon iconName={IconName.FullScreen} />
              </Button>
            </Tooltip>
            <Tooltip title="Hide panel" position={TooltipPosition.BottomLeft}>
              <Button
                size={ButtonSize.Medium}
                variant={ButtonVariant.Ghost}
                content={ButtonContent.Icon}
                aria-label="Hide panel"
                onClick={toggleSidePanelCollapsed}
              >
                <Icon iconName={IconName.CloseSidebar} />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">{body}</div>

      <SideBoxFooter
        sessionId={sessionId}
        workspace={snapshot?.workspace ?? null}
        revision={selectedRevision}
        compact={isTablet}
      />
    </div>
  );
}
