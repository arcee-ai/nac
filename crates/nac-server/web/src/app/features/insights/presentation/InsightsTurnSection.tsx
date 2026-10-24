import { ActionListButton } from "@/app/atoms";
import type {
  InsightEntry,
  InsightGroupEntry,
  InsightSegment,
  InsightThreadEntry,
  InsightTurnSection,
} from "@/app/features/insights/model/types";
import { formatInsightTime } from "@/app/features/insights/presentation/insightTime";
import type { RowView } from "@/app/features/insights/presentation/rows";
import { cn } from "@/app/lib/cn";

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
        onClick={controller.entryAction(entry) ?? undefined}
      />
      {expanded && entry.kind === "group"
        ? entry.group.segments.map((segment) => (
            <ActionListButton
              key={segment.key}
              {...controller.segmentView(segment)}
              depth={1}
              selected={controller.segmentSelected(entry, segment)}
              onClick={controller.segmentAction(entry, segment) ?? undefined}
            />
          ))
        : null}
    </>
  );
}

export function InsightsTurnSection({
  section,
  fallbackPrompt,
  first,
  controller,
}: {
  section: InsightTurnSection;
  /** Heading for a section without a prompt of its own. */
  fallbackPrompt: string;
  first: boolean;
  controller: InsightsRowController;
}) {
  const prompt = section.promptPreview || fallbackPrompt;
  const createdAt = formatInsightTime(section.createdAt);
  return (
    <div className="flex flex-col [&>*]:shrink-0">
      <h3
        className={cn(
          "flex items-center gap-1 border-b border-muted px-1 pb-0.5 leading-[14px] whitespace-nowrap text-basic-tertiary",
          // The list column already pads its top edge.
          first ? "h-[21px] pt-1" : "h-[33px] pt-4",
        )}
      >
        {section.ordinal === null ? null : (
          <span className="shrink-0 text-[10px]">#{section.ordinal}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px]">{prompt}</span>
        {createdAt === null ? null : <span className="shrink-0 text-[10px]">{createdAt}</span>}
      </h3>
      <div className="flex flex-col gap-0.5 py-2 [&>*]:shrink-0">
        {entryRuns(section.entries).map((run) =>
          run.kind === "wave" ? (
            <div
              key={`wave:${run.entries[0].id}`}
              className="flex flex-col gap-1 border-l border-primary py-1 pl-0.5 [&>*]:shrink-0"
            >
              {run.entries.map((entry) => (
                <EntryRows key={entry.id} entry={entry} controller={controller} />
              ))}
            </div>
          ) : (
            <EntryRows key={run.entry.id} entry={run.entry} controller={controller} />
          ),
        )}
      </div>
    </div>
  );
}
