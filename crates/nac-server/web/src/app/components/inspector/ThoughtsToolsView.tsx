import { useEffect, useMemo } from "react";

import { SegmentDetailList } from "@/app/components/inspector/agent-segments/SegmentDetailList";
import { ChildTranscriptPreview } from "@/app/components/inspector/ChildTranscriptPreview";
import {
  ActionItemList,
  ActionListEmpty,
  ActionTurnHeader,
  actionFilterEmptyCopy,
} from "@/app/components/inspector/ActionList";
import { PanelEmpty, PanelLoading, PanelSplit } from "@/app/components/inspector/PanelSplit";
import { usePagedRows } from "@/app/hooks/usePagedRows";
import { useLiveActionFollow } from "@/app/hooks/useLiveActionFollow";
import type { ActionItem } from "@/app/lib/actionsTimeline";
import {
  buildActionTimeline,
  flattenActionItems,
  liveTurnOriginKey,
} from "@/app/lib/actionsTimeline";
import type { AgentToolsGroup } from "@/app/lib/agentSegments";
import { groupIsSpawn } from "@/app/lib/spawnSession";
import { SESSION_PANEL_LABEL } from "@/app/lib/routes";
import { buildTranscript, withStreamedOutput } from "@/app/lib/transcript";
import { lockLiveActionFollow, selectAgentSegment } from "@/app/store/sessionLayoutStore";
import {
  useFinishedToolCalls,
  useLiveThreads,
  usePrimaryToolEvents,
  useStreamReasoning,
  useStreamText,
} from "@/app/store/runtimeStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

function selectedGroup(
  items: ReturnType<typeof flattenActionItems>,
  selected: string | null,
  newest: ActionItem | undefined,
): AgentToolsGroup | null {
  const match = newest
    ? newest
    : (items.find(
        (item) => (item.kind === "group" || item.kind === "spawn") && item.id === selected,
      ) ?? items.find((item) => item.kind === "group" || item.kind === "spawn"));
  if (!match || match.kind === "thread" || match.kind === "workset") return null;
  return match.group;
}

export function ThoughtsToolsView({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: SessionSnapshotResponse | null;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const liveThreads = useLiveThreads();
  const finishedToolCalls = useFinishedToolCalls();
  const primaryToolEvents = usePrimaryToolEvents();
  const streamText = useStreamText();
  const streamReasoning = useStreamReasoning();
  const sessionId = snapshot?.metadata.session_id ?? "";
  const runId = snapshot?.active_run?.run_id ?? null;
  const following = useLiveActionFollow(runId);

  const sections = useMemo(() => {
    const turns = withStreamedOutput(
      buildTranscript(snapshot, liveThreads, finishedToolCalls, primaryToolEvents),
      { text: streamText, reasoning: streamReasoning },
    );
    const live = Boolean(snapshot?.active_run) || Boolean(streamText) || Boolean(streamReasoning);
    return buildActionTimeline(turns, liveTurnOriginKey(turns, live));
  }, [snapshot, liveThreads, finishedToolCalls, primaryToolEvents, streamText, streamReasoning]);

  const items = useMemo(() => flattenActionItems(sections), [sections]);
  const newest = following ? items[0] : undefined;
  const current = selectedGroup(items, selected, newest);
  const spawn = current != null && groupIsSpawn(current);
  const currentRow = current
    ? sections.findIndex((section) =>
        section.items.some(
          (item) => (item.kind === "group" || item.kind === "spawn") && item.id === current.id,
        ),
      )
    : -1;
  const { visible, hasMore, sentinelRef } = usePagedRows(sections, {
    key: sessionId,
    atLeast: currentRow + 1,
  });
  const emptyCopy = actionFilterEmptyCopy("all", "agent");

  useEffect(() => {
    const target = following ? items[0] : null;
    if (target && (target.kind === "group" || target.kind === "spawn")) {
      if (selected === target.id) return;
      selectAgentSegment(target.id, { follow: true });
      return;
    }
    if (!current) return;
    if (selected === current.id) return;
    if (
      selected &&
      items.some((item) => (item.kind === "group" || item.kind === "spawn") && item.id === selected)
    ) {
      return;
    }
    onSelect(current.id);
  }, [following, selected, current, items, onSelect]);

  if (!snapshot) return <PanelLoading listTitle={SESSION_PANEL_LABEL.actions} />;

  return (
    <PanelSplit
      listTitle={SESSION_PANEL_LABEL.actions}
      title={current && !spawn ? actionTitle(current) : undefined}
      list={
        sections.length === 0 ? (
          <ActionListEmpty filter="all" kind="agent" />
        ) : (
          <>
            {visible.map((section) => (
              <div key={section.key} className="flex flex-col w-full">
                <ActionTurnHeader section={section} />
                <div className="flex flex-col py-2">
                  <ActionItemList
                    items={section.items}
                    selectedGroupId={current?.id ?? null}
                    selectedThreadEpisode={null}
                    episodeCount={() => 0}
                    pinToNewest={following && section.key === visible[0]?.key}
                    onSelectGroup={(id) => {
                      lockLiveActionFollow(runId);
                      onSelect(id);
                    }}
                    onSelectThread={() => undefined}
                  />
                </div>
              </div>
            ))}
            {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px" /> : null}
          </>
        )
      }
    >
      {current && spawn ? (
        <ChildTranscriptPreview parentSessionId={sessionId} group={current} />
      ) : current ? (
        <SegmentDetailList
          key={current.id}
          group={current}
          className="flex-1 min-h-0 overflow-auto py-4 [&>*]:shrink-0"
        />
      ) : (
        <PanelEmpty title={emptyCopy.title}>{emptyCopy.body}</PanelEmpty>
      )}
    </PanelSplit>
  );
}

function actionTitle(group: AgentToolsGroup): string {
  return group.label;
}
