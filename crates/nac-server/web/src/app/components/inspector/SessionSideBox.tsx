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
import { ChangesView } from "@/app/components/inspector/ChangesView";
import { ThreadsView } from "@/app/components/inspector/ThreadsView";
import { WorksetsView } from "@/app/components/inspector/WorksetsView";
import { SESSION_PANELS, type SessionPanel } from "@/app/lib/routes";
import {
  selectThread,
  selectWorkset,
  toggleSidePanelCollapsed,
  toggleSidePanelExpanded,
  useSelectedThread,
  useSelectedWorkset,
  useSidePanelLayout,
} from "@/app/store/sessionLayoutStore";
import type { SessionSnapshotResponse, WorkspaceSnapshot } from "@/app/types/api";

const PANEL_LABEL: Record<SessionPanel, string> = {
  changes: "Changes",
  worksets: "Worksets",
  threads: "Threads",
};

interface SessionSideBoxProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  panel: SessionPanel;
  onPanelChange: (panel: SessionPanel) => void;
}

function FooterChip({
  iconName,
  label,
}: {
  iconName: IconName;
  label: string;
}) {
  return (
    <div className="flex items-center gap-[6px] shrink-0 min-w-0 pl-1 pr-3 py-1 rounded-[4px]">
      <Icon iconName={iconName} size={16} />
      <span className="label-micro text-btn-secondary truncate">{label}</span>
    </div>
  );
}

/** Repo, branch and the running diff total, mirroring the Figma box footer. */
function SideBoxFooter({
  sessionId,
  workspace,
}: {
  sessionId: string;
  workspace: WorkspaceSnapshot | null;
}) {
  const repo = workspace?.repo_label ?? workspace?.workspace_display ?? null;
  const branch = workspace?.branch ?? null;
  const additions = workspace?.total_additions ?? 0;
  const deletions = workspace?.total_deletions ?? 0;

  return (
    <div className="flex h-10 items-center gap-[10px] px-4 shrink-0 border-t border-muted bg-elevation-level-2">
      <div className="flex flex-1 min-w-0 items-center gap-[10px]">
        {repo ? <FooterChip iconName={IconName.Folder} label={repo} /> : null}
        {branch ? <BranchPicker sessionId={sessionId} branch={branch} /> : null}
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
 * The left half of the session screen: one box with the Changes / Worksets /
 * Threads panels, sized by the shared layout store.
 */
export function SessionSideBox({
  sessionId,
  snapshot,
  panel,
  onPanelChange,
}: SessionSideBoxProps) {
  const layout = useSidePanelLayout();
  const expanded = layout === "expanded";
  const selectedThread = useSelectedThread();
  const selectedWorkset = useSelectedWorkset();

  return (
    <div className="flex flex-col min-h-0 h-full rounded-[8px] overflow-hidden bg-elevation-level-1">
      <div className="flex items-center gap-4 pl-1 pr-2 pt-1 shrink-0 border-b border-muted bg-elevation-level-2">
        <div className="flex flex-1 min-w-0 items-center gap-3" role="tablist">
          {SESSION_PANELS.map((name) => (
            <HorizontalTabsItem
              key={name}
              role="tab"
              aria-selected={panel === name}
              active={panel === name}
              variant={HorizontalTabsItemVariant.Neutral}
              onClick={() => onPanelChange(name)}
            >
              {PANEL_LABEL[name]}
            </HorizontalTabsItem>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-[2px] shrink-0">
          <Tooltip
            title={expanded ? "Restore split" : "Expand panel"}
            position={TooltipPosition.BottomRight}
          >
            <Button
              size={ButtonSize.Small}
              variant={ButtonVariant.Ghost}
              content={ButtonContent.Icon}
              aria-label={expanded ? "Restore split" : "Expand panel"}
              onClick={toggleSidePanelExpanded}
            >
              <Icon
                iconName={expanded ? IconName.FullScreenExit : IconName.FullScreen}
              />
            </Button>
          </Tooltip>
          <Tooltip title="Hide panel" position={TooltipPosition.BottomRight}>
            <Button
              size={ButtonSize.Small}
              variant={ButtonVariant.Ghost}
              content={ButtonContent.Icon}
              aria-label="Hide panel"
              onClick={toggleSidePanelCollapsed}
            >
              <Icon iconName={IconName.CloseSidebar} />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {panel === "changes" ? (
          <ChangesView sessionId={sessionId} snapshot={snapshot} />
        ) : null}
        {panel === "worksets" ? (
          <WorksetsView
            snapshot={snapshot}
            selected={selectedWorkset}
            onSelect={selectWorkset}
          />
        ) : null}
        {panel === "threads" ? (
          <ThreadsView
            snapshot={snapshot}
            selected={selectedThread}
            onSelect={selectThread}
          />
        ) : null}
      </div>

      <SideBoxFooter sessionId={sessionId} workspace={snapshot?.workspace ?? null} />
    </div>
  );
}
