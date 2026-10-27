import {
  createInsightGroup,
  insightAnchor,
  LEADING_ANCHOR,
  partitionModelTurn,
} from "@/app/features/insights/model/segments";
import type {
  InsightEntry,
  InsightSegment,
  InsightsEmptyCopy,
  InsightsFilter,
  InsightsFilterOption,
  InsightsTopology,
  InsightTurnSection,
} from "@/app/features/insights/model/types";
import { STREAMING_TURN_KEY, type TranscriptTurn } from "@/app/lib/transcript";

interface OpenSection extends Omit<InsightTurnSection, "entries"> {
  entries: InsightEntry[];
}

const FILTER_LABELS: Record<InsightsFilter, string> = {
  all: "All actions",
  tools: "Tools & reasoning",
  threads: "Threads",
  sessions: "Sessions",
  worksets: "Worksets",
};

const TOPOLOGY_FILTERS: Record<InsightsTopology, readonly InsightsFilterOption[]> = {
  orchestrator: (["all", "tools", "threads", "worksets"] as const).map((value) => ({
    value,
    label: FILTER_LABELS[value],
  })),
  direct: (["all", "tools", "sessions"] as const).map((value) => ({
    value,
    label: FILTER_LABELS[value],
  })),
};

const GROUP_FILTERS: Partial<Record<InsightsFilter, (segment: InsightSegment) => boolean>> = {
  tools: (segment) => segment.kind !== "workset",
  worksets: (segment) => segment.kind === "workset",
};

function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function countDispatches(turns: readonly TranscriptTurn[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const turn of turns) {
    if (turn.kind !== "model") continue;
    for (const block of turn.blocks) {
      if (block.kind !== "wave") continue;
      for (const thread of block.rows.flat()) {
        counts.set(thread.name, (counts.get(thread.name) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * One section per user turn, newest first, with its entries in chronological
 * order. Output after a delegated completion stays with the prompt before it.
 * Output before the first loaded prompt, and a streamed turn whose prompt the
 * snapshot does not show yet, form sections of their own without an ordinal.
 * Sections without entries are left out.
 */
export function buildInsightTimeline(turns: readonly TranscriptTurn[]): InsightTurnSection[] {
  const dispatches = countDispatches(turns);
  const sections: OpenSection[] = [];
  let current: OpenSection | null = null;
  let ordinal = 0;
  for (const [index, turn] of turns.entries()) {
    if (turn.kind === "user") {
      ordinal += 1;
      current = {
        key: turn.key,
        ordinal,
        promptPreview: singleLine(turn.text),
        createdAt: turn.createdAt,
        entries: [],
      };
      sections.push(current);
      continue;
    }
    if (turn.kind !== "model") continue;

    const previous = turns[index - 1];
    const provisional = insightAnchor(turn, previous) === STREAMING_TURN_KEY;
    if (!current || provisional) {
      current = {
        key: provisional ? STREAMING_TURN_KEY : LEADING_ANCHOR,
        ordinal: null,
        promptPreview: "",
        createdAt: null,
        entries: [],
      };
      sections.push(current);
    }
    for (const item of partitionModelTurn(turn, previous)) {
      if (item.kind !== "block") {
        current.entries.push(item);
      } else if (item.block.kind === "wave") {
        for (const thread of item.block.rows.flat()) {
          current.entries.push({
            kind: "thread",
            id: thread.key,
            thread,
            waveKey: item.block.key,
            episodes: dispatches.get(thread.name) ?? 1,
          });
        }
      }
    }
  }
  return sections.filter((section) => section.entries.length).reverse();
}

function filterEntry(entry: InsightEntry, filter: InsightsFilter): InsightEntry | null {
  if (entry.kind === "thread") return filter === "threads" ? entry : null;
  if (entry.kind === "session") return filter === "sessions" ? entry : null;
  const keep = GROUP_FILTERS[filter];
  if (!keep) return null;
  const segments = entry.group.segments.filter(keep);
  if (!segments.length) return null;
  if (segments.length === entry.group.segments.length) return entry;
  return { kind: "group", id: entry.id, group: createInsightGroup(entry.group.id, segments) };
}

/**
 * Narrowed groups keep their ids, so a selection made in a filtered view
 * resolves against the full timeline, where the detail reads it from.
 */
export function filterInsightTimeline(
  sections: readonly InsightTurnSection[],
  filter: InsightsFilter,
): InsightTurnSection[] {
  if (filter === "all") return [...sections];
  return sections.flatMap((section) => {
    const entries = section.entries.flatMap((entry) => filterEntry(entry, filter) ?? []);
    return entries.length ? [{ ...section, entries }] : [];
  });
}

/** Entries in display order: newest section first, chronological within each. */
export function flattenInsightEntries(sections: readonly InsightTurnSection[]): InsightEntry[] {
  return sections.flatMap((section) => section.entries);
}

export function findInsightEntry(
  sections: readonly InsightTurnSection[],
  id: string,
): InsightEntry | null {
  for (const section of sections) {
    const entry = section.entries.find((candidate) => candidate.id === id);
    if (entry) return entry;
  }
  return null;
}

/** The entry produced last, which closes the newest section. */
export function newestInsightEntry(sections: readonly InsightTurnSection[]): InsightEntry | null {
  return sections[0]?.entries.at(-1) ?? null;
}

export function insightFilterOptions(topology: InsightsTopology): readonly InsightsFilterOption[] {
  return TOPOLOGY_FILTERS[topology];
}

export function insightFilterEmptyCopy(
  filter: InsightsFilter,
  topology: InsightsTopology,
): InsightsEmptyCopy {
  const actor = topology === "orchestrator" ? "the orchestrator" : "the agent";
  switch (filter) {
    case "threads":
      return {
        title: "No threads yet.",
        body: "They appear here as the orchestrator assigns work.",
      };
    case "worksets":
      return {
        title: "No worksets yet.",
        body: "They appear here as the orchestrator defines them.",
      };
    case "sessions":
      return { title: "No sessions yet.", body: `They appear here as ${actor} delegates work.` };
    case "tools":
      return { title: "No thoughts or tools yet.", body: `They appear here as ${actor} works.` };
    case "all":
      return { title: "No actions yet.", body: `They appear here as ${actor} works.` };
  }
}
