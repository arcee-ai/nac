import { actionTypeLabel } from "@/app/features/insights/model/labels";
import { ItemCodeField } from "@/app/features/insights/presentation/items/ItemCodeField";
import {
  isDefault,
  showsInput,
  type ItemContent,
  type ItemContext,
  segmentCall,
  type ToolSegment,
} from "@/app/features/insights/presentation/items/itemContent";
import { BodyText } from "@/app/features/insights/presentation/items/ItemParts";

export function goalChangeContent(segment: ToolSegment): ItemContent {
  const text = segment.presentation?.summary || null;
  return {
    title: actionTypeLabel(segment.action),
    copyText: text,
    body: (state) => (text && showsInput(state) ? <BodyText>{text}</BodyText> : null),
  };
}

export function getGoalContent(segment: ToolSegment, context: ItemContext): ItemContent {
  const result = segment.presentation?.resultPreview || null;
  const call = segmentCall(segment);
  return {
    title: actionTypeLabel("get-goal"),
    copyText: result,
    body: (state) =>
      result && isDefault(state) ? (
        <ItemCodeField
          title="Results"
          shortContent={result}
          source="output"
          sessionId={context.sessionId}
          call={call}
        />
      ) : null,
  };
}
