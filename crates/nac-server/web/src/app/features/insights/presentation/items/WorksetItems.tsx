import { actionTypeLabel, segmentTitle } from "@/app/features/insights/model/labels";
import {
  isDefault,
  type ItemContent,
  type ToolSegment,
  type WorksetSegment,
} from "@/app/features/insights/presentation/items/itemContent";
import { SuccessText } from "@/app/features/insights/presentation/items/ItemParts";

export function worksetContent(segment: WorksetSegment): ItemContent {
  return { title: segmentTitle(segment) || actionTypeLabel("define-workset") };
}

export function deleteThreadContent(segment: ToolSegment): ItemContent {
  return {
    title: segmentTitle(segment),
    body: (state) =>
      isDefault(state) ? <SuccessText>The thread has been deleted.</SuccessText> : null,
  };
}
