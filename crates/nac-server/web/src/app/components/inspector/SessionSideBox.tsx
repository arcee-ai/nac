import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  ProgressLoader,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { FilesView } from "@/app/components/inspector/FilesView";
import { PanelCountBadge } from "@/app/components/inspector/PanelCountBadge";
import { panelBadgeCount, PANEL_ICON } from "@/app/components/inspector/sessionPanelIcons";
import { DelegatedWorkView } from "@/app/components/inspector/DelegatedWorkView";
import { HistoryView } from "@/app/components/inspector/HistoryView";
import { ThreadsView } from "@/app/components/inspector/ThreadsView";
import { WorksetsView } from "@/app/components/inspector/WorksetsView";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useSessionFetching } from "@/app/hooks/useSessionFetching";
import { SESSION_PANEL_LABEL, type SessionPanel } from "@/app/lib/routes";
import { cn } from "@/app/lib/cn";
import { sessionPanelPolicy } from "@/app/lib/sessionBehavior";
import { useManagedOrchestrators, useTraditionalChildren } from "@/app/services/queries";
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
import type { SessionBehavior, SessionSnapshotResponse } from "@/app/types/api";

interface SessionSideBoxProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  /**
   * Null while the session has not loaded. Callers that omit it keep the
   * snapshot's behavior, and an omitted stored behavior stays orchestrator.
   */
  behavior?: SessionBehavior | null;
  panel: SessionPanel;
  onPanelChange: (panel: SessionPanel) => void;
}

/**
 * The one place the panel admits to reloading. Everything below it keeps the
 * data it already has while a fetch runs, so this hairline is what tells apart
 * "nothing has changed" from "not asked yet".
 *
 * Its own component because it listens to every fetch in the session, and that
 * is a busy signal during a run: re-rendering the panels off it would undo the
 * quiet it is there to report.
 */
function SideBoxProgress({ sessionId }: { sessionId: string }) {
  const fetching = useSessionFetching(sessionId);
  return (
    <ProgressLoader active={fetching} className="absolute bottom-[-1px] left-0 right-0 z-[1]" />
  );
}

/**
 * The right half of the session screen: one box with the Threads / Files /
 * Worksets / Subagents panels, sized by the shared layout store. Session
 * switching lives in the left sidebar. On a phone the panels are the body of
 * the modal box that SessionPage puts them in, and its chrome — header, bottom
 * bar — belongs to the dialog rather than to this box.
 */
export function SessionSideBox({
  sessionId,
  snapshot,
  behavior: behaviorProp,
  panel,
  onPanelChange,
}: SessionSideBoxProps) {
  const expanded = useSidePanelExpanded();
  const isMobile = useIsMobile();
  const selectedThread = useSelectedThread();
  const selectedWorkset = useSelectedWorkset();
  const selectedRevision = useSelectedRevision();
  const behavior =
    behaviorProp !== undefined ? behaviorProp : (snapshot?.metadata.behavior ?? "orchestrator");
  const direct = behavior === "direct" || behavior === "direct-with-orchestrator";
  const panelPolicy =
    behavior == null ? null : sessionPanelPolicy(behavior, snapshot?.lineage?.kind);
  const delegatedTranscript = panelPolicy?.readOnly ?? false;
  const widePanels = panelPolicy?.widePanels ?? [];
  const subagents = widePanels.includes("delegated");
  const children = useTraditionalChildren(sessionId, subagents);
  const orchestrators = useManagedOrchestrators(
    sessionId,
    subagents && behavior === "direct-with-orchestrator",
  );
  const subagentCount = (children.data?.length ?? 0) + (orchestrators.data?.length ?? 0);

  // History belongs to the phone's bottom bar. On a wide screen the header
  // chip switches revisions, so a link to that panel lands on the default one.
  const active =
    panelPolicy == null
      ? null
      : widePanels.includes(panel) || (isMobile && panelPolicy.mobilePanels.includes(panel))
        ? panel
        : panelPolicy.defaultPanel;

  const body = (
    <>
      {active === "files" ? (
        <FilesView
          sessionId={sessionId}
          snapshot={snapshot}
          revision={selectedRevision}
          readOnly={delegatedTranscript}
        />
      ) : null}
      {active === "delegated" && direct && !delegatedTranscript ? (
        <DelegatedWorkView sessionId={sessionId} behavior={behavior} />
      ) : null}
      {active === "worksets" ? (
        <WorksetsView snapshot={snapshot} selected={selectedWorkset} onSelect={selectWorkset} />
      ) : null}
      {active === "threads" ? (
        <ThreadsView
          snapshot={snapshot}
          selected={selectedThread}
          onSelect={selectThread}
          canSteerWorkers={behavior === "orchestrator" && !delegatedTranscript}
        />
      ) : null}
      {active === "history" ? (
        <HistoryView sessionId={sessionId} selected={selectedRevision} onSelect={selectRevision} />
      ) : null}
    </>
  );

  if (isMobile) {
    return <div className="flex flex-col flex-1 min-h-0">{body}</div>;
  }

  return (
    <div
      className={cn(
        "flex flex-col min-h-0 h-full overflow-hidden bg-elevation-level-1",
        expanded ? null : "border-l border-muted",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-4 pl-3 pr-2 py-2 shrink-0 bg-elevation-level-1 relative border-b border-muted",
          // Room for the Modal's Close when this box is the fullscreen body.
          expanded ? "pr-10" : null,
        )}
      >
        <SideBoxProgress sessionId={sessionId} />
        <div className="flex flex-1 min-w-0 items-center gap-3" role="tablist">
          {widePanels.map((name) => {
            const selected = active === name;
            const badge = panelBadgeCount(
              name,
              subagentCount,
              snapshot?.worksets?.items.length ?? 0,
            );
            return (
              <span key={name} className="relative shrink-0">
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-label={SESSION_PANEL_LABEL[name]}
                  className={cn(
                    "btn btn-medium btn-icon-left !rounded-full",
                    selected ? "btn-secondary-highlighted" : "btn-ghost",
                  )}
                  onClick={() => {
                    // A tablet shows one column at a time, and a new panel opens on
                    // its selected row; a desktop split ignores the flag entirely.
                    showSidePanelList(false);
                    onPanelChange(name);
                  }}
                >
                  <Icon iconName={PANEL_ICON[name]} />
                  {SESSION_PANEL_LABEL[name]}
                </button>
                {badge > 0 ? <PanelCountBadge count={badge} /> : null}
              </span>
            );
          })}
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
                <Icon iconName={IconName.SidebarChevronRight} />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">{body}</div>
    </div>
  );
}
