import { InsightLinkButton } from "@/app/atoms";
import { actionTypeLabel, segmentTitle } from "@/app/features/insights/model/labels";
import {
  isDefault,
  type ItemContent,
  type ItemContext,
  type ToolSegment,
  type WorksetSegment,
} from "@/app/features/insights/presentation/items/itemContent";
import { SuccessText } from "@/app/features/insights/presentation/items/ItemParts";

export function worksetContent(segment: WorksetSegment, context: ItemContext): ItemContent {
  const { worksetId } = segment;
  return {
    title: actionTypeLabel("define-workset"),
    body: (state) =>
      worksetId && isDefault(state) ? (
        <InsightLinkButton
          label={segmentTitle(segment)}
          onClick={() => context.openWorkset(worksetId)}
        />
      ) : null,
  };
}

export function deleteThreadContent(segment: ToolSegment): ItemContent {
  return {
    title: segmentTitle(segment),
    body: (state) =>
      isDefault(state) ? <SuccessText>The thread has been deleted.</SuccessText> : null,
  };
}
