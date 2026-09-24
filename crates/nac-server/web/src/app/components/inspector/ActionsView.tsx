import { useEffect, useMemo } from "react";

import { ActionList } from "@/app/components/inspector/ActionList";
import { PanelEmpty, PanelLoading, PanelSplit } from "@/app/components/inspector/PanelSplit";
import { SegmentDetailList } from "@/app/components/inspector/agent-segments/SegmentDetailList";
import {
  actionFilterEmptyCopy,
  buildActionTimeline,
  flattenActionItems,
} from "@/app/lib/actionsTimeline";
import type { AgentToolsGroup } from "@/app/lib/agentSegments";
import { SESSION_PANEL_LABEL, type SessionPanel } from "@/app/lib/routes";
import { buildTranscript, withStreamedOutput } from "@/app/lib/transcript";
import {
  selectActionGroup,
  selectThread,
  selectWorkset,
  useSelectedActionGroup,
  useSelectedThreadEpisode,
} from "@/app/store/sessionLayoutStore";
import {
  useFinishedToolCalls,
  useLiveThreads,
  usePrimaryToolEvents,
  useStreamReasoning,
  useStreamText,
} from "@/app/store/runtimeStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

function selectedGroup(
  groups: readonly AgentToolsGroup[],
  selected: string | null,
): AgentToolsGroup | null {
  return groups.find((group) => group.id === selected) ?? groups[0] ?? null;
}

/**
 * Presentation-only projection of the existing transcript into the session
 * side box. Thread and workset rows hand off to their established panels;
 * thoughts and tool rows stay here and reuse the shared segment detail view.
 */
export function ActionsView({
  snapshot,
  onPanelChange,
}: {
  snapshot: SessionSnapshotResponse | null;
  onPanelChange: (panel: SessionPanel) => void;
}) {
  const liveThreads = useLiveThreads();
  const finishedToolCalls = useFinishedToolCalls();
  const primaryToolEvents = usePrimaryToolEvents();
  const streamText = useStreamText();
  const streamReasoning = useStreamReasoning();
  const selectedActionGroup = useSelectedActionGroup();
  const selectedThreadEpisode = useSelectedThreadEpisode();

  const sections = useMemo(() => {
    const turns = withStreamedOutput(
      buildTranscript(snapshot, liveThreads, finishedToolCalls, primaryToolEvents),
      { text: streamText, reasoning: streamReasoning },
    );
    return buildActionTimeline(turns);
  }, [snapshot, liveThreads, finishedToolCalls, primaryToolEvents, streamText, streamReasoning]);
  const items = useMemo(() => flattenActionItems(sections), [sections]);
  const groups = useMemo(
    () => items.flatMap((item) => (item.kind === "group" ? [item.group] : [])),
    [items],
  );
  const current = selectedGroup(groups, selectedActionGroup);
  const direct =
    snapshot?.metadata.behavior === "direct" ||
    snapshot?.metadata.behavior === "direct-with-orchestrator";
  const emptyCopy = actionFilterEmptyCopy("all", direct ? "agent" : "orchestrator");

  useEffect(() => {
    if (current && selectedActionGroup !== current.id) selectActionGroup(current.id);
  }, [current, selectedActionGroup]);

  if (!snapshot) return <PanelLoading listTitle={SESSION_PANEL_LABEL.actions} />;

  return (
    <PanelSplit
      listTitle={SESSION_PANEL_LABEL.actions}
      title={current?.label}
      listClassName="!pt-0"
      list={
        <ActionList
          sections={sections}
          kind={direct ? "agent" : "orchestrator"}
          selectedGroupId={current?.id ?? null}
          selectedThreadEpisode={selectedThreadEpisode}
          episodeCount={(name) =>
            snapshot.thread_episodes?.[name]?.length ??
            snapshot.threads.find((thread) => thread.name === name)?.episode_count ??
            0
          }
          onSelectGroup={(id) => {
            const item = items.find((candidate) => candidate.id === id);
            if (item?.kind === "workset") {
              selectWorkset(item.worksetId);
              onPanelChange("worksets");
              return;
            }
            selectActionGroup(id);
          }}
          onSelectThread={(name, episodeKey) => {
            selectThread(name, episodeKey);
            onPanelChange("threads");
          }}
        />
      }
    >
      {current ? (
        <SegmentDetailList
          key={current.id}
          group={current}
          hostRoots={[
            snapshot.workspace?.host_root,
            snapshot.metadata.workspace_host_path,
            snapshot.metadata.cwd,
          ]}
          className="flex-1 min-h-0 overflow-auto py-4 [&>*]:shrink-0"
        />
      ) : (
        <PanelEmpty title={emptyCopy.title}>{emptyCopy.body}</PanelEmpty>
      )}
    </PanelSplit>
  );
}
