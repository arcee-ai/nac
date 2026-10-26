import { segmentTitle } from "@/app/features/insights/model/labels";
import { ItemCodeField } from "@/app/features/insights/presentation/items/ItemCodeField";
import {
  isDefault,
  showsInput,
  type ItemContent,
  type ItemContext,
  segmentCall,
  type ToolSegment,
} from "@/app/features/insights/presentation/items/itemContent";

export function runCommandContent(segment: ToolSegment, context: ItemContext): ItemContent {
  const input = segment.presentation?.summary || null;
  const output = segment.presentation?.resultPreview || null;
  const call = segmentCall(segment);
  return {
    title: segmentTitle(segment),
    copyText: input,
    body: (state) => (
      <>
        {input && showsInput(state) ? (
          <ItemCodeField
            title="Input"
            shortContent={input}
            source="arguments"
            sessionId={context.sessionId}
            call={call}
          />
        ) : null}
        {output && isDefault(state) ? (
          <ItemCodeField
            title="Output"
            shortContent={output}
            source="output"
            sessionId={context.sessionId}
            call={call}
          />
        ) : null}
      </>
    ),
  };
}

export function writeCommandContent(segment: ToolSegment, context: ItemContext): ItemContent {
  const input = segment.presentation?.summary || null;
  const call = segmentCall(segment);
  return {
    title: segmentTitle(segment),
    copyText: input,
    body: (state) =>
      input && showsInput(state) ? (
        <ItemCodeField
          title="Input"
          showHeading={false}
          shortContent={input}
          source="arguments"
          sessionId={context.sessionId}
          call={call}
        />
      ) : null,
  };
}

export function readOutputContent(segment: ToolSegment, context: ItemContext): ItemContent {
  const output = segment.presentation?.resultPreview || null;
  const call = segmentCall(segment);
  return {
    title: "Read output",
    copyText: output,
    body: (state) =>
      output && isDefault(state) ? (
        <ItemCodeField
          title="Output"
          shortContent={output}
          source="output"
          sessionId={context.sessionId}
          call={call}
        />
      ) : null,
  };
}
