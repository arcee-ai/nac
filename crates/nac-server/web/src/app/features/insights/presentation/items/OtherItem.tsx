import { InsightCodeBox } from "@/app/atoms";
import { segmentTitle } from "@/app/features/insights/model/labels";
import {
  isDefault,
  showsInput,
  type ItemContent,
  type ToolSegment,
} from "@/app/features/insights/presentation/items/itemContent";

export function otherContent(segment: ToolSegment): ItemContent {
  const input = segment.presentation?.summary || null;
  const output = segment.presentation?.resultPreview || null;
  return {
    title: segmentTitle(segment),
    copyText: input ?? output,
    body: (state) => (
      <>
        {input && showsInput(state) ? <InsightCodeBox label="Input">{input}</InsightCodeBox> : null}
        {output && isDefault(state) ? (
          <InsightCodeBox label="Output">{output}</InsightCodeBox>
        ) : null}
      </>
    ),
  };
}
