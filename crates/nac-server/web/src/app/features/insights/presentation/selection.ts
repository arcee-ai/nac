import { findInsightEntry } from "@/app/features/insights/model/timeline";
import type {
  InsightEntry,
  InsightGroupEntry,
  InsightSegment,
  InsightTurnSection,
} from "@/app/features/insights/model/types";
import type { InsightSelection } from "@/app/store/sessionLayoutStore";

/** The detail pane reads groups from the unfiltered timeline. */
export type ShownInsight = { kind: "group"; entry: InsightGroupEntry; segmentKey: string | null };

/** Session rows navigate to another panel instead. */
export function opensInPlace(entry: InsightEntry): boolean {
  return entry.kind === "group";
}

export function resolveStoredInsight(
  selection: InsightSelection | null,
  timeline: readonly InsightTurnSection[],
): ShownInsight | null {
  if (selection?.kind !== "group") return null;
  const entry = findInsightEntry(timeline, selection.groupId);
  if (entry?.kind !== "group") return null;
  const known = entry.group.segments.some((segment) => segment.key === selection.segmentKey);
  return { kind: "group", entry, segmentKey: known ? selection.segmentKey : null };
}

export function newestShownInsight(
  sections: readonly InsightTurnSection[],
  timeline: readonly InsightTurnSection[],
): ShownInsight | null {
  for (const section of sections) {
    for (let index = section.entries.length - 1; index >= 0; index -= 1) {
      const entry = section.entries[index];
      if (!opensInPlace(entry)) continue;
      const full = findInsightEntry(timeline, entry.id);
      return full?.kind === "group" ? { kind: "group", entry: full, segmentKey: null } : null;
    }
  }
  return null;
}

export function hiddenByFilter(
  shown: ShownInsight,
  sections: readonly InsightTurnSection[],
): boolean {
  const entry = findInsightEntry(sections, shown.entry.id);
  if (entry?.kind !== "group") return true;
  return (
    shown.segmentKey !== null &&
    !entry.group.segments.some((segment) => segment.key === shown.segmentKey)
  );
}

export function entrySelected(
  entry: InsightEntry,
  shown: ShownInsight | null,
): boolean | undefined {
  if (!opensInPlace(entry)) return undefined;
  return shown !== null && shown.entry.id === entry.id;
}

export function segmentSelected(
  entry: InsightGroupEntry,
  segment: InsightSegment,
  shown: ShownInsight | null,
): boolean | undefined {
  return shown?.entry.id === entry.id && shown.segmentKey === segment.key;
}

export function sameInsight(a: ShownInsight | null, b: ShownInsight | null): boolean {
  if (a === null || b === null) return a === b;
  return a.entry.id === b.entry.id && a.segmentKey === b.segmentKey;
}
