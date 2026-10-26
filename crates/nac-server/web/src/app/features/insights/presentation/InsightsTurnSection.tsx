import { ActionListButton, ActionListSegment } from "@/app/atoms";
import type {
  InsightEntry,
  InsightGroupEntry,
  InsightSegment,
  InsightThreadEntry,
  InsightTurnSection,
} from "@/app/features/insights/model/types";
import { formatInsightDate } from "@/app/features/insights/presentation/insightTime";
import type { RowView } from "@/app/features/insights/presentation/rows";

export interface InsightsRowController {
  expanded: ReadonlySet<string>;
  entryView(entry: InsightEntry): RowView;
  segmentView(segment: InsightSegment): RowView;
  /** Undefined for rows that navigate away instead of selecting themselves. */
  entrySelected(entry: InsightEntry): boolean | undefined;
  segmentSelected(entry: InsightGroupEntry, segment: InsightSegment): boolean | undefined;
  /** Null when the row has nowhere to go. */
  entryAction(entry: InsightEntry): (() => void) | null;
  segmentAction(entry: InsightGroupEntry, segment: InsightSegment): (() => void) | null;
}

type EntryRun =
  | { kind: "wave"; entries: InsightThreadEntry[] }
  | { kind: "entry"; entry: InsightEntry };

/** Consecutive rows of one wave share a guide line. */
function entryRuns(entries: readonly InsightEntry[]): EntryRun[] {
  const runs: EntryRun[] = [];
  for (const entry of entries) {
    const last = runs.at(-1);
    if (entry.kind !== "thread") {
      runs.push({ kind: "entry", entry });
    } else if (last?.kind === "wave" && last.entries[0].waveKey === entry.waveKey) {
      last.entries.push(entry);
    } else {
      runs.push({ kind: "wave", entries: [entry] });
    }
  }
  return runs;
}

function EntryRows({
  entry,
  controller,
}: {
  entry: InsightEntry;
  controller: InsightsRowController;
}) {
  const view = controller.entryView(entry);
  const children = entry.kind === "group" && entry.group.segments.length > 1;
  const expanded = children && controller.expanded.has(entry.id);
  return (
    <>
      <ActionListButton
        {...view}
        selected={controller.entrySelected(entry)}
        expanded={children ? expanded : undefined}
        onClick={controller.entryAction(entry)}
      />
      {expanded && entry.kind === "group" ? (
        <ActionListSegment>
          {entry.group.segments.map((segment) => (
            <ActionListButton
              key={segment.key}
              {...controller.segmentView(segment)}
              selected={controller.segmentSelected(entry, segment)}
              onClick={controller.segmentAction(entry, segment)}
            />
          ))}
        </ActionListSegment>
      ) : null}
    </>
  );
}

export function InsightsTurnSection({
  section,
  fallbackPrompt,
  controller,
}: {
  section: InsightTurnSection;
  /** Heading for a section with neither a time nor a prompt of its own. */
  fallbackPrompt: string;
  controller: InsightsRowController;
}) {
  // A turn is headed by when it was sent; only a section with no time to show
  // (the turn still streaming, the actions before the first prompt) falls back
  // to words.
  const heading = formatInsightDate(section.createdAt) ?? (section.promptPreview || fallbackPrompt);
  return (
    <div className="flex flex-col [&>*]:shrink-0">
      <h3 className="truncate px-1 pt-4 pb-1 text-[11px] leading-[14px] text-basic-muted">
        {heading}
      </h3>
      <div className="flex flex-col gap-1 py-2 [&>*]:shrink-0">
        {entryRuns(section.entries).map((run) =>
          run.kind === "wave" ? (
            <ActionListSegment key={`wave:${run.entries[0].id}`}>
              {run.entries.map((entry) => (
                <EntryRows key={entry.id} entry={entry} controller={controller} />
              ))}
            </ActionListSegment>
          ) : (
            <EntryRows key={run.entry.id} entry={run.entry} controller={controller} />
          ),
        )}
      </div>
    </div>
  );
}
