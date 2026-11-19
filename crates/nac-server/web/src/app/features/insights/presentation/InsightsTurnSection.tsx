import { memo } from "react";

import { ActionListButton, ActionListButtonSize, ActionListSegment } from "@/app/atoms";
import type {
  InsightEntry,
  InsightGroupEntry,
  InsightSegment,
  InsightTurnSection,
} from "@/app/features/insights/model/types";
import { formatInsightDate } from "@/app/features/insights/presentation/insightTime";
import type { RowView } from "@/app/features/insights/presentation/rows";
import { cn } from "@/app/lib/cn";

export interface InsightsRowController {
  expanded: ReadonlySet<string>;
  entryView(entry: InsightEntry): RowView;
  segmentView(segment: InsightSegment): RowView;
  /** Undefined for rows that navigate away instead of selecting themselves. */
  entrySelected(entry: InsightEntry): boolean | undefined;
  segmentSelected(entry: InsightGroupEntry, segment: InsightSegment): boolean | undefined;
  /** The row the panel shows, which the list reveals whether or not it is marked. */
  entryShown(entry: InsightEntry): boolean;
  segmentShown(entry: InsightGroupEntry, segment: InsightSegment): boolean;
  /** Null when the row has nowhere to go. */
  entryAction(entry: InsightEntry): (() => void) | null;
  segmentAction(entry: InsightGroupEntry, segment: InsightSegment): (() => void) | null;
}

function EntryRows({
  entry,
  controller,
  size,
}: {
  entry: InsightEntry;
  controller: InsightsRowController;
  size: ActionListButtonSize;
}) {
  const view = controller.entryView(entry);
  const children = entry.kind === "group" && entry.group.segments.length > 1;
  const expanded = children && controller.expanded.has(entry.id);
  return (
    <>
      <ActionListButton
        {...view}
        className={cn(
          "!h-auto !py-1.5 !text-[13px] !leading-5",
          size === ActionListButtonSize.Large ? "!min-h-12 !text-[15px]" : "!min-h-8",
        )}
        size={size}
        metaClassName="text-xs leading-4 tabular text-basic-tertiary"
        selected={controller.entrySelected(entry)}
        shown={controller.entryShown(entry)}
        expanded={children ? expanded : undefined}
        onClick={controller.entryAction(entry)}
      />
      {expanded && entry.kind === "group" ? (
        <ActionListSegment>
          {entry.group.segments.map((segment) => (
            <ActionListButton
              key={segment.key}
              {...controller.segmentView(segment)}
              className={cn(
                "!h-auto !py-1.5 !text-[13px] !leading-5",
                size === ActionListButtonSize.Large ? "!min-h-12 !text-[15px]" : "!min-h-8",
              )}
              size={size}
              metaClassName="text-xs leading-4 tabular text-basic-tertiary"
              selected={controller.segmentSelected(entry, segment)}
              shown={controller.segmentShown(entry, segment)}
              onClick={controller.segmentAction(entry, segment)}
            />
          ))}
        </ActionListSegment>
      ) : null}
    </>
  );
}

export const InsightsTurnSection = memo(function InsightsTurnSection({
  section,
  fallbackPrompt,
  controller,
  size,
}: {
  section: InsightTurnSection;
  /** Heading for a section with neither a time nor a prompt of its own. */
  fallbackPrompt: string;
  controller: InsightsRowController;
  /** Large on a phone. */
  size: ActionListButtonSize;
}) {
  // A turn is headed by when it was sent; only a section with no time to show
  // (the turn still streaming, the actions before the first prompt) falls back
  // to words.
  const heading = formatInsightDate(section.createdAt) ?? (section.promptPreview || fallbackPrompt);
  const large = size === ActionListButtonSize.Large;
  return (
    <div className="flex flex-col [&>*]:shrink-0">
      <h3
        className={cn(
          "truncate type-meta tabular text-basic-muted",
          large ? "px-3 pt-6 pb-1.5" : "px-2.5 pt-4 pb-1",
        )}
      >
        {heading}
      </h3>
      <div className="flex flex-col gap-0.5 py-1 [&>*]:shrink-0">
        {section.entries.map((entry) => (
          <EntryRows key={entry.id} entry={entry} controller={controller} size={size} />
        ))}
      </div>
    </div>
  );
});
