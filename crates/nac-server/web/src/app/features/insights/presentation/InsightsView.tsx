import { useLayoutEffect, useMemo, useRef } from "react";

import { PanelEmpty, PanelLoading, PanelSplit } from "@/app/components/inspector/PanelSplit";
import { useTranscriptModelContext } from "@/app/components/inspector/transcript/TranscriptModelContext";
import { useThreadRunState } from "@/app/components/inspector/threads/useThreadRunState";
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
import { InsightsFilter } from "@/app/features/insights/presentation/InsightsFilter";
import { InsightsList } from "@/app/features/insights/presentation/InsightsList";
import type { InsightsRowController } from "@/app/features/insights/presentation/InsightsTurnSection";
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
  segmentSelected,
} from "@/app/features/insights/presentation/selection";
import { useDelegatedSessions } from "@/app/features/insights/presentation/useDelegatedSessions";
import { useThreadOwnership } from "@/app/features/insights/presentation/useInsightsThread";
import { useInsightsNavigation } from "@/app/features/insights/useInsightsNavigation";
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
export function InsightsView({ sessionId, snapshot, topology }: InsightsViewProps) {
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

  const options = insightFilterOptions(topology);
  const storedFilter = useInsightsFilter();
  const filter = options.some((option) => option.value === storedFilter) ? storedFilter : "all";
  const timeline = useMemo(() => buildInsightTimeline(model.turns), [model.turns]);
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
      entrySelected: (entry) => entrySelected(entry, shown),
      segmentSelected: (entry, segment) => segmentSelected(entry, segment, shown),
      entryAction,
      segmentAction,
    };
  }, [
    expanded,
    sources,
    shown,
    navigation,
    resolveSession,
    selectInsight,
    selectThread,
    showSidePanelList,
    toggleInsightGroup,
  ]);

  if (!snapshot) return <PanelLoading listTitle="Insights" />;

  // A pick the new filter hides gives way to the newest action it shows.
  const changeFilter = (next: InsightsFilterValue) => {
    selectInsightsFilter(next);
    if (picked && next !== "all" && hiddenByFilter(picked, filterInsightTimeline(timeline, next))) {
      selectInsight(null);
    }
  };
  const emptyCopy = insightFilterEmptyCopy(filter, topology);
  const title =
    shown?.kind === "thread"
      ? shown.name
      : shown?.kind === "group"
        ? entryRowView(shown.entry, sources).label
        : undefined;

  return (
    <PanelSplit
      listTitle="Insights"
      listToolbar={<InsightsFilter options={options} value={filter} onChange={changeFilter} />}
      title={title}
      list={
        <InsightsList
          sections={sections}
          pendingPrompt={model.pendingText}
          emptyCopy={emptyCopy}
          focusNonce={focusNonce}
          controller={controller}
        />
      }
    >
      {sections.length === 0 && !shown ? (
        <PanelEmpty title={emptyCopy.title}>{emptyCopy.body}</PanelEmpty>
      ) : (
        <PanelEmpty title={title ?? "No action selected"}>
          Select an action in the list to see its details.
        </PanelEmpty>
      )}
    </PanelSplit>
  );
}
