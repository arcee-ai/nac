import { useMemo } from "react";

import { PanelEmpty } from "@/app/components/inspector/PanelSplit";
import { useTranscriptModelContext } from "@/app/components/inspector/transcript/TranscriptModelContext";
import { entryRow } from "@/app/features/insights/model/labels";
import {
  buildInsightTimeline,
  filterInsightTimeline,
  findInsightEntry,
  insightFilterEmptyCopy,
} from "@/app/features/insights/model/timeline";
import type {
  InsightEntry,
  InsightsTopology,
  InsightTurnSection,
} from "@/app/features/insights/model/types";
import { cn } from "@/app/lib/cn";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { SessionSnapshotResponse } from "@/app/types/api";

export interface InsightsViewProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  topology: InsightsTopology;
  /** Only a user-owned classic orchestrator may steer its workers from a thread. */
  canSteerWorkers: boolean;
}

function rowText(entry: InsightEntry): string {
  const row = entryRow(entry);
  return row.meta ? `${row.label} · ${row.meta}` : row.label;
}

function sectionHeading(section: InsightTurnSection): string {
  const ordinal = section.ordinal == null ? null : `#${section.ordinal}`;
  return [ordinal, section.promptPreview].filter(Boolean).join(" · ");
}

/** The Insights panel: what the session did, grouped by the prompt that asked for it. */
export function InsightsView({ topology }: InsightsViewProps) {
  const { useInsightsFilter, useSelectedInsight, useSelectedThread, useSelectedThreadEpisode } =
    useNativeRuntime().stores.sessionLayoutStore;
  const { turns } = useTranscriptModelContext();
  const filter = useInsightsFilter();
  const selected = useSelectedInsight();
  const selectedThread = useSelectedThread();
  const selectedEpisode = useSelectedThreadEpisode();
  const timeline = useMemo(() => buildInsightTimeline(turns), [turns]);
  const sections = useMemo(() => filterInsightTimeline(timeline, filter), [timeline, filter]);

  const isSelected = (entry: InsightEntry) =>
    selected?.kind === "group"
      ? entry.id === selected.groupId
      : selected?.kind === "thread" &&
        entry.kind === "thread" &&
        (selectedEpisode == null
          ? entry.thread.name === selectedThread
          : entry.id === selectedEpisode);
  const selectedGroup =
    selected?.kind === "group" ? findInsightEntry(timeline, selected.groupId) : null;
  const selectedText =
    selected?.kind === "thread"
      ? selectedThread
      : selected?.kind === "group"
        ? [selectedGroup ? rowText(selectedGroup) : selected.groupId, selected.segmentKey]
            .filter(Boolean)
            .join(" · ")
        : null;

  if (sections.length === 0) {
    const empty = insightFilterEmptyCopy(filter, topology);
    return <PanelEmpty title={empty.title}>{empty.body}</PanelEmpty>;
  }
  return (
    <div className="flex flex-1 flex-col min-h-0 gap-4 overflow-auto p-4 code code-small [&>*]:shrink-0">
      {selectedText ? <p className="truncate text-basic-primary">{selectedText}</p> : null}
      {sections.map((section) => (
        <section key={section.key} className="flex flex-col gap-1 [&>*]:shrink-0">
          <p className="truncate text-basic-tertiary">{sectionHeading(section)}</p>
          {section.entries.map((entry) => (
            <p
              key={entry.id}
              aria-current={isSelected(entry) || undefined}
              className={cn(
                "truncate",
                isSelected(entry) ? "text-basic-primary" : "text-basic-muted",
              )}
            >
              {rowText(entry)}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
