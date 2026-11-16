import { HeartbeatPanel } from "@/app/features/heartbeats/HeartbeatPanel";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
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
import { TerminalWorkspace } from "@/app/features/terminal-selection/TerminalWorkspace";
import { InsightsReturnButton } from "@/app/features/insights/presentation/InsightsReturnButton";
import { InsightsView } from "@/app/features/insights/presentation/InsightsView";
import { FilesView } from "@/app/components/inspector/FilesView";
import { PanelListNote } from "@/app/components/inspector/PanelMessages";
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
  /** The drawer's way out. Omitted, the header has no Close (a bare test mount). */
  onClose?: () => void;
  /** Whether the drawer is docked beside the chat rather than floating. */
  pinned?: boolean;
  /** Dock or float the drawer (⌘\); omitted where docking has no room. */
  onTogglePinned?: () => void;
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
 * The panels a session's drawer holds: Insights, Files (Changes), Subagents,
 * Terminal, Schedules, Worksets, History — whichever the session's behavior
 * has. On a wide screen it heads itself with a 52px bar: a quiet segmented
 * row to move between the panels, then dock, full width and close. On a
 * phone the drawer is a bottom sheet and each screen heads itself with the
 * way out the sheet lends it.
 */
export function SessionSideBox({
  sessionId,
  snapshot,
  behavior: behaviorProp,
  panel,
  onPanelChange,
  onClose,
  pinned = false,
  onTogglePinned,
}: SessionSideBoxProps) {
  const {
    useSidePanelExpanded,
    useSelectedWorkset,
    useSelectedRevision,
    toggleSidePanelExpanded,
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

  // History is a phone panel. On a wide screen the session menu switches
  // revisions, so a link to that panel lands on the default one.
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
        <>
          <InsightsReturnButton sessionId={sessionId} />
          <DelegatedWorkView sessionId={sessionId} behavior={behavior} />
        </>
      ) : null}
      {active === "terminal" && direct && !delegatedTranscript ? (
        <TerminalWorkspace sessionId={sessionId} />
      ) : null}
      {active === "heartbeats" ? <HeartbeatPanel sessionId={sessionId} /> : null}
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
    // draw both of their screens through their split. Until the session's
    // behavior is known there is no panel at all, but the dialog still needs a
    // screen with its way out.
    return (
      <div className="flex flex-col flex-1 min-h-0 bg-elevation-ground">
        {active === null ? (
          <PanelPhoneScreen title={SESSION_PANEL_LABEL[panel]} bar>
            <div className="pt-14">
              <PanelListNote>The panels show once the session has loaded.</PanelListNote>
            </div>
          </PanelPhoneScreen>
        ) : active === "history" ? (
          <PanelPhoneScreen title={SESSION_PANEL_LABEL[active]} bar>
            {/* History scrolls under the header. */}
            {body}
          </PanelPhoneScreen>
        ) : (
          body
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 h-full overflow-hidden">
      <div className="relative flex h-[52px] shrink-0 items-center gap-1 border-b border-muted pr-2 pl-3">
        <SideBoxProgress sessionId={sessionId} />
        <div className="flex min-w-0 flex-1">
          <div
            role="tablist"
            aria-label="Session panels"
            className="flex min-w-0 items-center gap-0.5 rounded-pill bg-[var(--f-wash-1)] p-0.5"
          >
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
                showSidePanelList(isTablet && selected && name === "insights");
                onPanelChange(name);
              };
              // The open panel names itself; the others are glyphs with
              // tooltips, so any number of panels fits the 560px drawer.
              const iconsOnly = !selected;
              const tab = (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-label={SESSION_PANEL_LABEL[name]}
                  onClick={open}
                  className={cn(
                    "type-label flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-2.5 outline-none",
                    "transition-[background-color,color,box-shadow] duration-150 ease-out motion-reduce:transition-none",
                    "focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
                    iconsOnly && (badge > 0 ? "px-2" : "w-8 justify-center px-0"),
                    selected
                      ? "bg-elevation-level-1 text-basic-primary shadow-sm"
                      : "text-basic-tertiary hover:text-basic-primary",
                  )}
                >
                  <Icon iconName={PANEL_ICON[name]} size={16} className="shrink-0" />
                  {iconsOnly ? null : <span>{SESSION_PANEL_LABEL[name]}</span>}
                  {badge > 0 ? (
                    <span className="type-tag tabular text-basic-tertiary">{badge}</span>
                  ) : null}
                </button>
              );
              return iconsOnly ? (
                <Tooltip
                  key={name}
                  title={SESSION_PANEL_LABEL[name]}
                  position={TooltipPosition.BottomCenter}
                >
                  {tab}
                </Tooltip>
              ) : (
                <span key={name} className="contents">
                  {tab}
                </span>
              );
            })}
          </div>
        </div>
        {onTogglePinned ? (
          <Tooltip
            title={pinned ? "Float the drawer (⌘\\)" : "Dock beside the conversation (⌘\\)"}
            position={TooltipPosition.BottomLeft}
            className="shrink-0"
          >
            <Button
              size={ButtonSize.Medium}
              variant={pinned ? ButtonVariant.GhostHighlighted : ButtonVariant.Ghost}
              content={ButtonContent.Icon}
              aria-label={pinned ? "Float drawer" : "Dock drawer"}
              aria-pressed={pinned}
              onClick={onTogglePinned}
            >
              <Icon iconName={IconName.ShowSidePanel} />
            </Button>
          </Tooltip>
        ) : null}
        {pinned ? null : (
          <Tooltip
            title={expanded ? "Exit full width" : "Full width"}
            position={TooltipPosition.BottomLeft}
            className="shrink-0"
          >
            <Button
              size={ButtonSize.Medium}
              variant={ButtonVariant.Ghost}
              content={ButtonContent.Icon}
              aria-label={expanded ? "Exit full width" : "Expand panel"}
              aria-pressed={expanded}
              onClick={toggleSidePanelExpanded}
            >
              <Icon iconName={expanded ? IconName.FullScreenExit : IconName.FullScreen} />
            </Button>
          </Tooltip>
        )}
        {onClose ? (
          <Tooltip title="Close (Esc)" position={TooltipPosition.BottomLeft} className="shrink-0">
            <Button
              size={ButtonSize.Medium}
              variant={ButtonVariant.Ghost}
              content={ButtonContent.Icon}
              aria-label="Hide panel"
              onClick={onClose}
            >
              <Icon iconName={IconName.Close} />
            </Button>
          </Tooltip>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">{body}</div>
    </div>
  );
}
