import { actionTypeLabel } from "@/app/features/insights/model/labels";
import { ItemCodeField } from "@/app/features/insights/presentation/items/ItemCodeField";
import {
  isDefault,
  showsInput,
  type ItemContent,
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

export function getGoalContent(segment: ToolSegment): ItemContent {
  const result = segment.presentation?.resultPreview || null;
  const callId = segment.presentation?.callId ?? null;
  return {
    title: actionTypeLabel("get-goal"),
    copyText: result,
    body: (state) =>
      result && isDefault(state) ? (
        <ItemCodeField title="Results" shortContent={result} source="output" callId={callId} />
      ) : null,
  };
}
