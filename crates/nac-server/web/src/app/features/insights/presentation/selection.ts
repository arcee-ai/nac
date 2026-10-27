import { findInsightEntry } from "@/app/features/insights/model/timeline";
import type {
  InsightEntry,
  InsightGroupEntry,
  InsightSegment,
  InsightTurnSection,
} from "@/app/features/insights/model/types";
import type { InsightSelection } from "@/app/store/sessionLayoutStore";

/** What the detail pane shows; groups always come from the unfiltered timeline. */
export type ShownInsight =
  | { kind: "group"; entry: InsightGroupEntry; segmentKey: string | null }
  | { kind: "thread"; name: string; episode: string | null };

export interface StoredThread {
  name: string | null;
  episode: string | null;
}

/** Session rows and workset-only groups navigate to another panel instead. */
export function opensInPlace(entry: InsightEntry): boolean {
  if (entry.kind === "thread") return true;
  if (entry.kind === "session") return false;
  return entry.group.segments.some((segment) => segment.kind !== "workset");
}

/** The pick stored in the layout store, while it still names something on the page. */
export function resolveStoredInsight(
  selection: InsightSelection | null,
  thread: StoredThread,
  timeline: readonly InsightTurnSection[],
  ownsThread: (name: string) => boolean,
): ShownInsight | null {
  if (selection?.kind === "group") {
    const entry = findInsightEntry(timeline, selection.groupId);
    if (entry?.kind !== "group") return null;
    const known = entry.group.segments.some((segment) => segment.key === selection.segmentKey);
    return {
      kind: "group",
      entry,
      segmentKey: known ? selection.segmentKey : null,
    };
  }
  if (selection?.kind === "thread" && thread.name && ownsThread(thread.name)) {
    return { kind: "thread", name: thread.name, episode: thread.episode };
  }
  return null;
}

/** The newest entry the filtered list shows that has a detail of its own. */
export function newestShownInsight(
  sections: readonly InsightTurnSection[],
  timeline: readonly InsightTurnSection[],
): ShownInsight | null {
  for (const section of sections) {
    for (let index = section.entries.length - 1; index >= 0; index -= 1) {
      const entry = section.entries[index];
      if (!opensInPlace(entry)) continue;
      if (entry.kind === "thread") {
        return { kind: "thread", name: entry.thread.name, episode: entry.id };
      }
      const full = findInsightEntry(timeline, entry.id);
      return full?.kind === "group" ? { kind: "group", entry: full, segmentKey: null } : null;
    }
  }
  return null;
}

function threadMatches(entry: InsightEntry, shown: ShownInsight): boolean {
  if (entry.kind !== "thread" || shown.kind !== "thread") return false;
  return shown.episode ? entry.id === shown.episode : entry.thread.name === shown.name;
}

export function hiddenByFilter(
  shown: ShownInsight,
  sections: readonly InsightTurnSection[],
): boolean {
  if (shown.kind === "thread") {
    return !sections.some((section) =>
      section.entries.some((entry) => threadMatches(entry, shown)),
    );
  }
  const entry = findInsightEntry(sections, shown.entry.id);
  if (entry?.kind !== "group") return true;
  return (
    shown.segmentKey !== null &&
    !entry.group.segments.some((segment) => segment.key === shown.segmentKey)
  );
}

/** Undefined for rows that navigate away, which never show as selected. */
export function entrySelected(
  entry: InsightEntry,
  shown: ShownInsight | null,
): boolean | undefined {
  if (!opensInPlace(entry)) return undefined;
  if (!shown) return false;
  if (entry.kind === "thread") return threadMatches(entry, shown);
  return shown.kind === "group" && shown.entry.id === entry.id;
}

export function segmentSelected(
  entry: InsightGroupEntry,
  segment: InsightSegment,
  shown: ShownInsight | null,
): boolean | undefined {
  if (segment.kind === "workset") return undefined;
  return shown?.kind === "group" && shown.entry.id === entry.id && shown.segmentKey === segment.key;
}
