import { actionTypeLabel } from "@/app/features/insights/model/labels";
import {
  withDuration,
  type ItemContent,
  type ReasoningSegment,
} from "@/app/features/insights/presentation/items/itemContent";
import { ReasoningText } from "@/app/features/insights/presentation/items/ItemParts";

/** The text stays visible while it streams, so the detail can follow it. */
export function reasoningContent(segment: ReasoningSegment): ItemContent {
  return {
    title: withDuration(actionTypeLabel("reasoning"), segment.durationMs),
    copyText: segment.text,
    body: () =>
      segment.text ? <ReasoningText text={segment.text} streaming={segment.streaming} /> : null,
  };
}
