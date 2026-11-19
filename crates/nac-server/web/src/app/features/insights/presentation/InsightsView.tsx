import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import { PanelEmptyState } from "@/app/components/inspector/PanelMessages";
import { PanelLoading, PanelSplit } from "@/app/components/inspector/PanelSplit";
import { PanelQuiet } from "@/app/components/inspector/PanelQuiet";
import { useTranscriptModelContext } from "@/app/components/inspector/transcript/TranscriptModelContext";
import {
  buildInsightTimeline,
  filterInsightTimeline,
  insightFilterEmptyCopy,
  insightFilterOptions,
} from "@/app/features/insights/model/timeline";
import type {
  DelegatedRowKey,
  InsightEntry,
  InsightGroupEntry,
  InsightSegment,
  InsightsFilter as InsightsFilterValue,
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
  INSIGHTS_DETAIL_ID,
  useInsightsDetailFocus,
  useInsightsNavigation,
} from "@/app/features/insights/useInsightsNavigation";
import { usePanelListMarksOpen } from "@/app/hooks/usePanelListMarksOpen";
import { useSharedValue, useStructuralSharing } from "@/app/lib/useSharedValue";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { SessionSnapshotResponse } from "@/app/types/api";

export interface InsightsViewProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
}

/**
 * The Insights panel: what the session did, grouped by the prompt that asked
 * for it, beside the detail of the picked action. Until a row is picked the
 * detail follows the newest action.
 */
export function InsightsView({ sessionId, snapshot }: InsightsViewProps) {
  const {
    useInsightsFilter,
    useSelectedInsight,
    useInsightFocusNonce,
    useExpandedInsightGroups,
    selectInsight,
    selectInsightsFilter,
    showSidePanelList,
    toggleInsightGroup,
    rememberInsightsReturn,
  } = useNativeRuntime().stores.sessionLayoutStore;
  const model = useTranscriptModelContext();
  const navigation = useInsightsNavigation();

  const options = insightFilterOptions();
  const storedFilter = useInsightsFilter();
  const filter = options.some((option) => option.value === storedFilter) ? storedFilter : "all";
  // Rebuilt on every delta, though prose changes no group and reasoning only
  // the one it streams into: what did not change keeps its identity, so the
  // rows and the detail showing it skip the render.
  const timeline = useStructuralSharing(
    useMemo(() => buildInsightTimeline(model.turns), [model.turns]),
  );
  const sections = useMemo(() => filterInsightTimeline(timeline, filter), [timeline, filter]);
  const resolveSession = useDelegatedSessions(sessionId, snapshot, timeline);

  const selection = useSelectedInsight();
  const focusNonce = useInsightFocusNonce();
  const expanded = useExpandedInsightGroups();
  const picked = useMemo(
    () => resolveStoredInsight(selection, { name: null, episode: null }, timeline, () => false),
    [selection, timeline],
  );
  const shown = useMemo(
    () => picked ?? newestShownInsight(sections, timeline),
    [picked, sections, timeline],
  );
  // Rows only ask whether they are the one shown, so they follow its identity
  // rather than the entry object, which a streaming group replaces per delta.
  const highlighted = useSharedValue(shown, sameInsight);
  const marked = usePanelListMarksOpen() ? highlighted : null;

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

  const openSubagent = useCallback(
    (rowKey: DelegatedRowKey) => {
      const origin =
        highlighted?.kind === "group"
          ? {
              kind: "group" as const,
              groupId: highlighted.entry.id,
              segmentKey: highlighted.segmentKey,
            }
          : null;
      rememberInsightsReturn(sessionId, origin);
      navigation.openSubagent(rowKey);
    },
    [navigation, rememberInsightsReturn, sessionId, highlighted],
  );

  const controller = useMemo<InsightsRowController>(() => {
    const segmentAction = (entry: InsightGroupEntry, segment: InsightSegment) => {
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
      if (entry.kind === "thread") return null;
      if (entry.kind === "session") {
        const session = resolveSession(entry.rowKey);
        return session ? () => openSubagent(session.rowKey) : null;
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
      entrySelected: (entry) => entrySelected(entry, marked),
      segmentSelected: (entry, segment) => segmentSelected(entry, segment, marked),
      entryShown: (entry) => entrySelected(entry, highlighted) === true,
      segmentShown: (entry, segment) => segmentSelected(entry, segment, highlighted) === true,
      entryAction,
      segmentAction,
    };
  }, [
    expanded,
    sources,
    marked,
    highlighted,
    openSubagent,
    resolveSession,
    selectInsight,
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
      openSubagent,
      workspaceRoots: [hostRoot, workspaceHostPath, cwd],
      filePathPrefix,
      openFile: navigation.openFile,
    }),
    [
      sessionId,
      resolveSession,
      navigation,
      openSubagent,
      hostRoot,
      filePathPrefix,
      workspaceHostPath,
      cwd,
    ],
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
  const emptyCopy = useMemo(() => insightFilterEmptyCopy(filter), [filter]);
  const hasOlder = snapshot?.message_page?.has_older === true;
  // A new element on every render would undo the list's memo.
  const loadOlder = useMemo(
    () => (hasOlder ? <InsightsLoadOlder sessionId={sessionId} /> : null),
    [hasOlder, sessionId],
  );

  if (!snapshot) return <PanelLoading listTitle="Insights" />;
  // A thread the chat pointed Insights at still opens with no turns.
  if (!shown && !hasOlder && model.turns.length === 0) {
    return (
      <PanelEmptyState
        listTitle="Insights"
        title="No insights yet"
        description="Send the first message in this session to be able to see them"
      />
    );
  }

  let title: ReactNode;
  let detail: ReactNode;
  if (shown?.kind === "group") {
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
    detail = <PanelQuiet title={emptyCopy.title}>{emptyCopy.body}</PanelQuiet>;
  } else {
    detail = (
      <PanelQuiet title="No action selected">
        Select an action in the list to see its details.
      </PanelQuiet>
    );
  }

  return (
    <>
      <PanelSplit
        listTitle="Insights"
        phoneListToolbarInFlow
        listToolbar={<InsightsFilter options={options} value={filter} onChange={changeFilter} />}
        listClassName="p-2"
        title={title}
        list={
          <InsightsList
            sessionId={sessionId}
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
    </>
  );
}
