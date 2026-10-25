import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  HorizontalTabsItem,
  HorizontalTabsItemSize,
  Icon,
  IconName,
  ProgressLoader,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { TerminalWorkspace } from "@/app/features/terminal-selection/TerminalWorkspace";
import { InsightsView } from "@/app/features/insights/presentation/InsightsView";
import { FilesView } from "@/app/components/inspector/FilesView";
import { PanelCountBadge } from "@/app/components/inspector/PanelCountBadge";
import { PanelPhoneScreen } from "@/app/components/inspector/PanelPhoneScreen";
import { panelBadgeCount, PANEL_ICON } from "@/app/components/inspector/sessionPanelIcons";
import { DelegatedWorkView } from "@/app/components/inspector/DelegatedWorkView";
import { HistoryView } from "@/app/components/inspector/HistoryView";
import { WorksetsView } from "@/app/components/inspector/WorksetsView";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { useSessionFetching } from "@/app/hooks/useSessionFetching";
import { SESSION_PANEL_LABEL, type SessionPanel } from "@/app/lib/routes";
import { cn } from "@/app/lib/cn";
import { sessionPanelPolicy } from "@/app/lib/sessionBehavior";
import { useManagedOrchestrators, useTraditionalChildren } from "@/app/services/queries";

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
 * The right column of the session screen: one box with the Insights / Files /
 * Worksets / Subagents panels, sized by the shared layout store. Session
 * switching lives in the left sidebar. On a phone the panels are the body of
 * the modal box that SessionPage puts them in, each screen heading itself with
 * the way out and the tab bar the dialog lends it.
 */
export function SessionSideBox({
  sessionId,
  snapshot,
  behavior: behaviorProp,
  panel,
  onPanelChange,
}: SessionSideBoxProps) {
  const {
    useSidePanelExpanded,
    useSelectedWorkset,
    useSelectedRevision,
    toggleSidePanelExpanded,
    toggleSidePanelCollapsed,
    showSidePanelList,
    selectWorkset,
    selectRevision,
  } = useNativeRuntime().stores.sessionLayoutStore;

  const expanded = useSidePanelExpanded();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const selectedWorkset = useSelectedWorkset();
  const selectedRevision = useSelectedRevision();
  const behavior =
    behaviorProp !== undefined ? behaviorProp : (snapshot?.metadata.behavior ?? "orchestrator");
  const direct = behavior === "direct" || behavior === "direct-with-orchestrator";
  const panelPolicy =
    behavior == null ? null : sessionPanelPolicy(behavior, snapshot?.lineage?.kind);
  const delegatedTranscript = panelPolicy?.readOnly ?? false;
  const widePanels = panelPolicy?.widePanels ?? [];
  const policy = useUiPolicy();
  const subagents = widePanels.includes("delegated");
  const children = useTraditionalChildren(sessionId, subagents);
  const orchestrators = useManagedOrchestrators(
    sessionId,
    subagents && behavior === "direct-with-orchestrator",
  );
  const subagentCount =
    (children.data?.length ?? 0) +
    (policy.orchestrationEnabled ? (orchestrators.data?.length ?? 0) : 0);

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
      {active === "insights" ? (
        <InsightsView
          sessionId={sessionId}
          snapshot={snapshot}
          topology={direct ? "direct" : "orchestrator"}
          canSteerWorkers={behavior === "orchestrator" && !delegatedTranscript}
        />
      ) : null}
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
      {active === "terminal" && direct && !delegatedTranscript ? (
        <TerminalWorkspace sessionId={sessionId} />
      ) : null}
      {active === "worksets" ? (
        <WorksetsView snapshot={snapshot} selected={selectedWorkset} onSelect={selectWorkset} />
      ) : null}
      {active === "history" ? (
        <HistoryView sessionId={sessionId} selected={selectedRevision} onSelect={selectRevision} />
      ) : null}
    </>
  );

  if (isMobile) {
    // A panel without rows to list is a list screen of its own; the others
    // draw both of their screens through their split.
    return (
      <div className="flex flex-col flex-1 min-h-0 bg-elevation-ground">
        {active === "terminal" || active === "history" ? (
          <PanelPhoneScreen title={SESSION_PANEL_LABEL[active]} bar>
            {/* History scrolls under the header; the terminal keeps its own frame. */}
            {active === "terminal" ? (
              <div className="flex flex-col flex-1 min-h-0 pt-14">{body}</div>
            ) : (
              body
            )}
          </PanelPhoneScreen>
        ) : (
          body
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col min-h-0 h-full overflow-hidden bg-elevation-ground",
        expanded ? null : "border-l border-tertiary",
      )}
    >
      <div className="relative flex items-center gap-2 px-2 py-2 shrink-0 border-b border-muted bg-elevation-ground">
        <SideBoxProgress sessionId={sessionId} />
        {/* Hide/expand live here in the split. Once fullscreen the Modal owns
            Close at the trailing corner, and equal blanks keep the tabs centred
            clear of it. */}
        {expanded ? (
          <span aria-hidden className="size-9 shrink-0" />
        ) : (
          <Tooltip title="Hide panel" position={TooltipPosition.BottomRight} className="shrink-0">
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
        )}
        {/* Auto margins rather than `justify-center`: tabs wider than the bar
            overflow its trailing end instead of losing their first ones. */}
        <div className="flex flex-1 min-w-0">
          <div className="flex min-w-0 items-center gap-2 mx-auto" role="tablist">
            {widePanels.map((name) => {
              const selected = active === name;
              const badge = panelBadgeCount(
                name,
                subagentCount,
                snapshot?.worksets?.items.length ?? 0,
              );
              const open = () => {
                // A tablet shows one column at a time, and a new panel opens on
                // its selected row; a desktop split ignores the flag entirely.
                showSidePanelList(false);
                onPanelChange(name);
              };
              return (
                <span key={name} className="relative shrink-0">
                  {/* The tablet's narrower box draws the tabs as icon circles. */}
                  {isTablet ? (
                    <Tooltip
                      title={SESSION_PANEL_LABEL[name]}
                      position={TooltipPosition.BottomCenter}
                    >
                      <Button
                        className="!rounded-full"
                        size={ButtonSize.Medium}
                        variant={selected ? ButtonVariant.Primary : ButtonVariant.Ghost}
                        content={ButtonContent.Icon}
                        role="tab"
                        aria-selected={selected}
                        aria-label={SESSION_PANEL_LABEL[name]}
                        onClick={open}
                      >
                        <Icon iconName={PANEL_ICON[name]} />
                      </Button>
                    </Tooltip>
                  ) : (
                    <HorizontalTabsItem
                      size={HorizontalTabsItemSize.Medium}
                      active={selected}
                      iconName={PANEL_ICON[name]}
                      role="tab"
                      aria-selected={selected}
                      aria-label={SESSION_PANEL_LABEL[name]}
                      onClick={open}
                    >
                      {SESSION_PANEL_LABEL[name]}
                    </HorizontalTabsItem>
                  )}
                  {badge > 0 ? <PanelCountBadge count={badge} className="top-0" /> : null}
                </span>
              );
            })}
          </div>
        </div>
        {expanded ? (
          <span aria-hidden className="size-9 shrink-0" />
        ) : (
          <Tooltip title="Expand panel" position={TooltipPosition.BottomLeft} className="shrink-0">
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
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">{body}</div>
    </div>
  );
}
