import { useEffect, useMemo } from "react";

import { SegmentDetailList } from "@/app/components/inspector/agent-segments/SegmentDetailList";
import { ChildTranscriptPreview } from "@/app/components/inspector/ChildTranscriptPreview";
import {
  ActionFilterBar,
  ActionItemList,
  ActionTurnHeader,
} from "@/app/components/inspector/ActionList";
import { PanelEmpty, PanelLoading, PanelSplit } from "@/app/components/inspector/PanelSplit";
import { usePagedRows } from "@/app/hooks/usePagedRows";
import type { ActionFilter } from "@/app/lib/actionsTimeline";
import {
  buildActionTimeline,
  filterActionTimeline,
  flattenActionItems,
  liveTurnOriginKey,
} from "@/app/lib/actionsTimeline";
import type { AgentToolsGroup } from "@/app/lib/agentSegments";
import { groupIsSpawn } from "@/app/lib/spawnSession";
import { SESSION_PANEL_LABEL } from "@/app/lib/routes";
import { buildTranscript, withStreamedOutput } from "@/app/lib/transcript";
import { useActionFilter } from "@/app/store/actionFilterStore";
import {
  useFinishedToolCalls,
  useLiveThreads,
  usePrimaryToolEvents,
  useStreamReasoning,
  useStreamText,
} from "@/app/store/runtimeStore";
import type { SessionSnapshotResponse } from "@/app/types/api";


const AGENT_FILTERS: readonly ActionFilter[] = ["all", "tools", "sessions"];

function selectedGroup(
  items: ReturnType<typeof flattenActionItems>,
  selected: string | null,
): AgentToolsGroup | null {
  const match =
    items.find(
      (item) => (item.kind === "group" || item.kind === "spawn") && item.id === selected,
    ) ?? items.find((item) => item.kind === "group" || item.kind === "spawn");
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
  const [filter, setFilter] = useActionFilter("agent", AGENT_FILTERS);

  const sections = useMemo(() => {
    const turns = withStreamedOutput(
      buildTranscript(snapshot, liveThreads, finishedToolCalls, primaryToolEvents),
      { text: streamText, reasoning: streamReasoning },
    );
    const live = Boolean(snapshot?.active_run) || Boolean(streamText) || Boolean(streamReasoning);
    return buildActionTimeline(turns, liveTurnOriginKey(turns, live));
  }, [snapshot, liveThreads, finishedToolCalls, primaryToolEvents, streamText, streamReasoning]);

  const visibleSections = useMemo(() => filterActionTimeline(sections, filter), [sections, filter]);
  const items = useMemo(() => flattenActionItems(visibleSections), [visibleSections]);
  const current = selectedGroup(items, selected);
  const spawn = current != null && groupIsSpawn(current);
  const currentRow = current
    ? visibleSections.findIndex((section) =>
        section.items.some(
          (item) => (item.kind === "group" || item.kind === "spawn") && item.id === current.id,
        ),
      )
    : -1;
  const { visible, hasMore, sentinelRef } = usePagedRows(visibleSections, {
    key: `${sessionId}:${filter}`,
    atLeast: currentRow + 1,
  });

  useEffect(() => {
    if (!current) return;
    if (selected === current.id) return;
    if (
      selected &&
      items.some((item) => (item.kind === "group" || item.kind === "spawn") && item.id === selected)
    ) {
      return;
    }
    onSelect(current.id);
  }, [selected, current, items, onSelect]);

  if (!snapshot) return <PanelLoading listTitle={SESSION_PANEL_LABEL.actions} />;

  return (
    <PanelSplit
      listTitle={SESSION_PANEL_LABEL.actions}
      title={current && !spawn ? actionTitle(current) : undefined}
      listToolbar={<ActionFilterBar value={filter} options={AGENT_FILTERS} onChange={setFilter} />}
      list={
        visibleSections.length === 0 ? (
          <div className="flex flex-col px-2 pb-4 pt-2 text-micro">
            <p className="text-basic-tertiary">No actions yet.</p>
            <p className="text-basic-muted">They appear here as the agent works.</p>
          </div>
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
                    onSelectGroup={onSelect}
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
          className="flex-1 min-h-0 overflow-auto px-4 py-4 [&>*]:shrink-0"
        />
      ) : (
        <PanelEmpty title="No actions yet.">
          Send a message and the agent will show reasoning, tool calls, and spawned sessions here.
        </PanelEmpty>
      )}
    </PanelSplit>
  );
}

function actionTitle(group: AgentToolsGroup): string {
  return group.label;
}
