import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { PanelEmpty, PanelLoading, PanelSplit } from "@/app/components/inspector/PanelSplit";
import { TaskButton, TaskPill } from "@/app/components/inspector/TaskPreview";
import { ThreadSteeringModal } from "@/app/components/inspector/ThreadSteeringModal";
import { ThreadDetail } from "@/app/components/inspector/threads/ThreadDetail";
import {
  ThreadViewSelect,
  type ThreadDetailView,
} from "@/app/components/inspector/threads/ThreadViewControls";
import { useThreadRunState } from "@/app/components/inspector/threads/useThreadRunState";
import { useTranscriptModelContext } from "@/app/components/inspector/transcript/TranscriptModelContext";
import {
  buildInsightTimeline,
  filterInsightTimeline,
  insightFilterEmptyCopy,
  insightFilterOptions,
} from "@/app/features/insights/model/timeline";
import type {
  InsightEntry,
  InsightGroupEntry,
  InsightSegment,
  InsightsFilter as InsightsFilterValue,
  InsightsTopology,
} from "@/app/features/insights/model/types";
import { InsightsDetail } from "@/app/features/insights/presentation/InsightsDetail";
import { InsightsFilter } from "@/app/features/insights/presentation/InsightsFilter";
import { InsightsList } from "@/app/features/insights/presentation/InsightsList";
import { InsightsLoadOlder } from "@/app/features/insights/presentation/InsightsLoadOlder";
import type { InsightsRowController } from "@/app/features/insights/presentation/InsightsTurnSection";
import type { ItemContext } from "@/app/features/insights/presentation/items/itemContent";
import {
  entryRowView,
  segmentRowView,
  type RowSources,
} from "@/app/features/insights/presentation/rows";
import {
  entrySelected,
  hiddenByFilter,
  newestShownInsight,
  resolveStoredInsight,
  sameInsight,
  segmentSelected,
} from "@/app/features/insights/presentation/selection";
import { useDelegatedSessions } from "@/app/features/insights/presentation/useDelegatedSessions";
import {
  useInsightsThreadPane,
  useThreadOwnership,
} from "@/app/features/insights/presentation/useInsightsThread";
import {
  INSIGHTS_DETAIL_ID,
  useInsightsDetailFocus,
  useInsightsNavigation,
} from "@/app/features/insights/useInsightsNavigation";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { useSharedValue, useStructuralSharing } from "@/app/lib/useSharedValue";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { SessionSnapshotResponse } from "@/app/types/api";

export interface InsightsViewProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  topology: InsightsTopology;
  /** Only a user-owned classic orchestrator may steer its workers from a thread. */
  canSteerWorkers: boolean;
}

/**
 * The Insights panel: what the session did, grouped by the prompt that asked
 * for it, beside the detail of the picked action. Until a row is picked the
 * detail follows the newest action.
 */
export function InsightsView({
  sessionId,
  snapshot,
  topology,
  canSteerWorkers,
}: InsightsViewProps) {
  const {
    useInsightsFilter,
    useSelectedInsight,
    useSelectedThread,
    useSelectedThreadEpisode,
    useInsightFocusNonce,
    useExpandedInsightGroups,
    selectInsight,
    selectInsightsFilter,
    selectThread,
    showSidePanelList,
    toggleInsightGroup,
  } = useNativeRuntime().stores.sessionLayoutStore;
  const model = useTranscriptModelContext();
  const navigation = useInsightsNavigation();
  const runState = useThreadRunState(snapshot);

  const options = useMemo(() => insightFilterOptions(topology), [topology]);
  const storedFilter = useInsightsFilter();
  const filter = options.some((option) => option.value === storedFilter) ? storedFilter : "all";
  // Rebuilt on every delta, though prose changes no group and reasoning only
  // the one it streams into: what did not change keeps its identity, so the
  // rows and the detail showing it skip the render.
  const timeline = useStructuralSharing(
    useMemo(() => buildInsightTimeline(model.turns), [model.turns]),
  );
  const sections = useMemo(() => filterInsightTimeline(timeline, filter), [timeline, filter]);
  const ownsThread = useThreadOwnership(snapshot, timeline, runState.liveThreads);
  const resolveSession = useDelegatedSessions(sessionId, snapshot, timeline);

  const selection = useSelectedInsight();
  const storedThread = useSelectedThread();
  const storedEpisode = useSelectedThreadEpisode();
  const focusNonce = useInsightFocusNonce();
  const expanded = useExpandedInsightGroups();
  const picked = useMemo(
    () =>
      resolveStoredInsight(
        selection,
        { name: storedThread, episode: storedEpisode },
        timeline,
        ownsThread,
      ),
    [selection, storedThread, storedEpisode, timeline, ownsThread],
  );
  const shown = useMemo(
    () => picked ?? newestShownInsight(sections, timeline),
    [picked, sections, timeline],
  );
  // Rows only ask whether they are the one shown, so they follow its identity
  // rather than the entry object, which a streaming group replaces per delta.
  const highlighted = useSharedValue(shown, sameInsight);

  // A pick from another surface can name an entry the current filter hides,
  // and only a list showing it may sit beside its detail.
  const handledNonce = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (handledNonce.current === focusNonce) return;
    handledNonce.current = focusNonce;
    if (!picked) return;
    if (filter !== "all" && hiddenByFilter(picked, sections)) selectInsightsFilter("all");
    if (picked.kind === "group" && picked.segmentKey && picked.entry.group.segments.length > 1) {
      toggleInsightGroup(picked.entry.id, true);
    }
  }, [focusNonce, picked, filter, sections, selectInsightsFilter, toggleInsightGroup]);

  const threads = snapshot?.threads;
  const sources = useMemo<RowSources>(
    () => ({
      resolveSession,
      episodeCounts: new Map((threads ?? []).map((thread) => [thread.name, thread.episode_count])),
    }),
    [resolveSession, threads],
  );

  const controller = useMemo<InsightsRowController>(() => {
    const segmentAction = (entry: InsightGroupEntry, segment: InsightSegment) => {
      if (segment.kind === "workset") {
        const { worksetId } = segment;
        return worksetId ? () => navigation.openWorkset(worksetId) : null;
      }
      return () => {
        selectInsight({
          kind: "group",
          groupId: entry.id,
          segmentKey: segment.key,
        });
        showSidePanelList(false);
      };
    };
    const entryAction = (entry: InsightEntry) => {
      if (entry.kind === "thread") {
        return () => {
          selectThread(entry.thread.name, entry.id);
          selectInsight({ kind: "thread" });
        };
      }
      if (entry.kind === "session") {
        const session = resolveSession(entry.rowKey);
        return session ? () => navigation.openSubagent(session.rowKey) : null;
      }
      const { segments } = entry.group;
      if (segments.length === 1) return segmentAction(entry, segments[0]);
      return () => {
        toggleInsightGroup(entry.id);
        selectInsight({ kind: "group", groupId: entry.id, segmentKey: null });
      };
    };
    return {
      expanded,
      entryView: (entry) => entryRowView(entry, sources),
      segmentView: (segment) => segmentRowView(segment, sources),
      entrySelected: (entry) => entrySelected(entry, highlighted),
      segmentSelected: (entry, segment) => segmentSelected(entry, segment, highlighted),
      entryAction,
      segmentAction,
    };
  }, [
    expanded,
    sources,
    highlighted,
    navigation,
    resolveSession,
    selectInsight,
    selectThread,
    showSidePanelList,
    toggleInsightGroup,
  ]);

  const hostRoot = snapshot?.workspace?.host_root;
  const filePathPrefix = snapshot?.workspace?.file_path_prefix;
  const workspaceHostPath = snapshot?.metadata.workspace_host_path;
  const cwd = snapshot?.metadata.cwd;
  const itemContext = useMemo<ItemContext>(
    () => ({
      sessionId,
      resolveSession,
      openSubagent: navigation.openSubagent,
      openWorkset: navigation.openWorkset,
      workspaceRoots: [hostRoot, workspaceHostPath, cwd],
      filePathPrefix,
      openFile: navigation.openFile,
    }),
    [sessionId, resolveSession, navigation, hostRoot, filePathPrefix, workspaceHostPath, cwd],
  );
  const [threadView, setThreadView] = useState<ThreadDetailView>("log");
  const [steeringThread, setSteeringThread] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const threadPane = useInsightsThreadPane(
    snapshot,
    shown?.kind === "thread" ? shown.name : null,
    runState,
    canSteerWorkers,
  );
  // A resolved pick is what the detail shows; list rows never ask for focus.
  const detailRef = useInsightsDetailFocus(selection, snapshot != null && picked != null);

  // Read when the filter changes rather than captured, so the select keeps one
  // handler while a reply streams into the timeline.
  const current = useRef({ picked, timeline });
  useLayoutEffect(() => {
    current.current = { picked, timeline };
  });
  // A pick the new filter hides gives way to the newest action it shows.
  const changeFilter = useCallback(
    (next: InsightsFilterValue) => {
      selectInsightsFilter(next);
      const latest = current.current;
      const shownByNext = filterInsightTimeline(latest.timeline, next);
      if (latest.picked && next !== "all" && hiddenByFilter(latest.picked, shownByNext)) {
        selectInsight(null);
      }
    },
    [selectInsightsFilter, selectInsight],
  );
  const emptyCopy = useMemo(() => insightFilterEmptyCopy(filter, topology), [filter, topology]);
  const hasOlder = snapshot?.message_page?.has_older === true;
  // A new element on every render would undo the list's memo.
  const loadOlder = useMemo(
    () => (hasOlder ? <InsightsLoadOlder sessionId={sessionId} /> : null),
    [hasOlder, sessionId],
  );

  if (!snapshot) return <PanelLoading listTitle="Insights" />;

  let title: ReactNode;
  let detail: ReactNode;
  if (shown?.kind === "thread" && threadPane) {
    const { thread, eventLog } = threadPane;
    // The panel truncates the title on its own box, which leaves this one free
    // to shimmer.
    title = <span className={cn(threadPane.running && "text-shimmer-basic")}>{thread.name}</span>;
    detail = (
      <ThreadDetail
        key={`${sessionId}:${thread.name}`}
        thread={thread}
        action={threadPane.action}
        episodes={threadPane.episodes}
        events={eventLog.events}
        liveLog={threadPane.liveLog}
        running={threadPane.running}
        hasOlder={eventLog.hasOlder}
        loadingOlder={eventLog.loadingOlder}
        loadingInitial={eventLog.loadingInitial}
        historyError={eventLog.historyError}
        onLoadOlder={eventLog.loadOlder}
        onRetry={eventLog.retry}
        view={threadView}
        canSteer={threadPane.canSteer}
        onSteer={() => setSteeringThread(thread.name)}
        onViewChange={setThreadView}
      />
    );
  } else if (shown?.kind === "group") {
    title = entryRowView(shown.entry, sources).label;
    detail = (
      <InsightsDetail
        key={shown.entry.id}
        group={shown.entry.group}
        segmentKey={shown.segmentKey}
        focusNonce={focusNonce}
        context={itemContext}
      />
    );
  } else if (sections.length === 0) {
    detail = <PanelEmpty title={emptyCopy.title}>{emptyCopy.body}</PanelEmpty>;
  } else {
    detail = (
      <PanelEmpty title="No action selected">
        Select an action in the list to see its details.
      </PanelEmpty>
    );
  }

  return (
    <>
      <PanelSplit
        listTitle="Insights"
        listToolbar={<InsightsFilter options={options} value={filter} onChange={changeFilter} />}
        listClassName="p-2"
        title={title}
        titleAction={
          threadPane?.action && !isMobile ? <TaskButton action={threadPane.action} /> : null
        }
        actions={
          // A phone's thread detail floats Steer and the view switch itself.
          isMobile ? (
            threadPane?.action ? (
              <TaskPill action={threadPane.action} />
            ) : null
          ) : threadPane ? (
            <div className="flex items-center gap-2">
              {threadPane.canSteer ? (
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Secondary}
                  onClick={() => setSteeringThread(threadPane.thread.name)}
                >
                  Steer
                </Button>
              ) : null}
              <ThreadViewSelect view={threadView} onChange={setThreadView} />
            </div>
          ) : null
        }
        list={
          <InsightsList
            sections={sections}
            pendingPrompt={model.pendingText}
            emptyCopy={emptyCopy}
            focusNonce={focusNonce}
            controller={controller}
            footer={loadOlder}
          />
        }
      >
        <div
          ref={detailRef}
          id={INSIGHTS_DETAIL_ID}
          role="region"
          aria-label="Insights detail"
          tabIndex={-1}
          className="flex flex-col flex-1 min-w-0 min-h-0 -outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2"
        >
          {detail}
        </div>
      </PanelSplit>
      {steeringThread ? (
        <ThreadSteeringModal
          sessionId={sessionId}
          threadName={steeringThread}
          onClose={() => setSteeringThread(null)}
        />
      ) : null}
    </>
  );
}
