import { InsightCodeBox } from "@/app/atoms";
import { actionTypeLabel } from "@/app/features/insights/model/labels";
import {
  isDefault,
  showsInput,
  withDuration,
  type ItemContent,
  type ToolSegment,
} from "@/app/features/insights/presentation/items/itemContent";
import { BodyText } from "@/app/features/insights/presentation/items/ItemParts";

/** No favicons: the detail never loads anything from the sites it names. */
export function webContent(segment: ToolSegment): ItemContent {
  const input = segment.presentation?.summary || null;
  const result = segment.presentation?.resultPreview || null;
  return {
    title: withDuration(actionTypeLabel(segment.action), segment.presentation?.durationMs),
    copyText: input,
    body: (state) => (
      <>
        {input && showsInput(state) ? <InsightCodeBox>{input}</InsightCodeBox> : null}
        {result && isDefault(state) ? <BodyText>{result}</BodyText> : null}
      </>
    ),
  };
}

export function fileSearchContent(segment: ToolSegment): ItemContent {
  const pattern = segment.presentation?.summary || null;
  const matches = segment.presentation?.resultPreview || null;
  return {
    title: actionTypeLabel(segment.action),
    copyText: pattern,
    body: (state) => (
      <>
        {pattern && showsInput(state) ? <InsightCodeBox>{pattern}</InsightCodeBox> : null}
        {matches && isDefault(state) ? <InsightCodeBox>{matches}</InsightCodeBox> : null}
      </>
    ),
  };
}
