import { useEffect, useMemo } from "react";

import { Icon, IconName, Loader, LoaderSize, LoaderVariant } from "@/app/atoms";
import {
  PanelEmpty,
  PanelLoading,
  PanelRow,
  PanelSplit,
} from "@/app/components/inspector/PanelSplit";
import { SegmentDetailList } from "@/app/components/inspector/agent-segments/SegmentDetailList";
import { usePagedRows } from "@/app/hooks/usePagedRows";
import {
  collectAgentToolsGroups,
  configForSegment,
  type AgentToolsGroup,
} from "@/app/lib/agentSegments";
import { buildTranscript, withStreamedOutput } from "@/app/lib/transcript";
import {
  useFinishedToolCalls,
  useLiveThreads,
  usePrimaryToolEvents,
  useStreamReasoning,
  useStreamText,
} from "@/app/store/runtimeStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

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

  const groups = useMemo(() => {
    const turns = withStreamedOutput(
      buildTranscript(
        snapshot,
        liveThreads,
        finishedToolCalls,
        primaryToolEvents,
      ),
      { text: streamText, reasoning: streamReasoning },
    );
    return collectAgentToolsGroups(turns);
  }, [
    snapshot,
    liveThreads,
    finishedToolCalls,
    primaryToolEvents,
    streamText,
    streamReasoning,
  ]);

  const current =
    groups.find((group) => group.id === selected) ?? groups[0] ?? null;
  const currentRow = current
    ? groups.findIndex((group) => group.id === current.id)
    : -1;
  const { visible, hasMore, sentinelRef } = usePagedRows(groups, {
    key: sessionId,
    atLeast: currentRow + 1,
  });

  useEffect(() => {
    if (!current) return;
    if (selected === current.id) return;
    if (selected && groups.some((group) => group.id === selected)) return;
    onSelect(current.id);
  }, [selected, current, groups, onSelect]);

  if (!snapshot) return <PanelLoading listTitle="Thoughts & Tools" />;

  return (
    <PanelSplit
      listTitle="Thoughts & Tools"
      title={current?.label}
      list={
        groups.length === 0 ? (
          <div className="flex flex-col px-2 pb-4 pt-2 text-micro">
            <p className="text-basic-tertiary">No thoughts or tools yet.</p>
            <p className="text-basic-muted">
              They appear here as the agent works.
            </p>
          </div>
        ) : (
          <>
            {visible.map((group) => (
              <ThoughtsToolsRow
                key={group.id}
                group={group}
                active={group.id === current?.id}
                onSelect={onSelect}
              />
            ))}
            {hasMore ? (
              <div ref={sentinelRef} aria-hidden className="h-px" />
            ) : null}
          </>
        )
      }
    >
      {current ? (
        <SegmentDetailList
          key={current.id}
          group={current}
          className="flex-1 min-h-0 overflow-auto px-4 py-4 [&>*]:shrink-0"
        />
      ) : (
        <PanelEmpty title="No thoughts or tools yet.">
          Send a message and the agent will show reasoning and tool calls here.
        </PanelEmpty>
      )}
    </PanelSplit>
  );
}

function ThoughtsToolsRow({
  group,
  active,
  onSelect,
}: {
  group: AgentToolsGroup;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const lead = group.segments[0];
  const icon = lead ? configForSegment(lead).icon : IconName.Brain;
  return (
    <PanelRow
      label={group.label}
      active={active}
      icon={
        group.inProgress ? (
          <Loader size={LoaderSize.Micro} variant={LoaderVariant.Neutral} />
        ) : (
          <Icon iconName={icon} size={16} className="shrink-0" />
        )
      }
      trailing={
        <span className="code code-micro text-basic-muted shrink-0">
          {group.segments.length}
        </span>
      }
      onClick={() => onSelect(group.id)}
    />
  );
}
