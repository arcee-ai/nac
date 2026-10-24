import { segmentTitle } from "@/app/features/insights/model/labels";
import { ItemCodeField } from "@/app/features/insights/presentation/items/ItemCodeField";
import {
  isDefault,
  showsInput,
  type ItemContent,
  type ToolSegment,
} from "@/app/features/insights/presentation/items/itemContent";

export function runCommandContent(segment: ToolSegment): ItemContent {
  const input = segment.presentation?.summary || null;
  const output = segment.presentation?.resultPreview || null;
  const callId = segment.presentation?.callId ?? null;
  return {
    title: segmentTitle(segment),
    copyText: input,
    body: (state) => (
      <>
        {input && showsInput(state) ? (
          <ItemCodeField title="Input" shortContent={input} source="arguments" callId={callId} />
        ) : null}
        {output && isDefault(state) ? (
          <ItemCodeField title="Output" shortContent={output} source="output" callId={callId} />
        ) : null}
      </>
    ),
  };
}

export function writeCommandContent(segment: ToolSegment): ItemContent {
  const input = segment.presentation?.summary || null;
  const callId = segment.presentation?.callId ?? null;
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
          callId={callId}
        />
      ) : null,
  };
}

export function readOutputContent(segment: ToolSegment): ItemContent {
  const output = segment.presentation?.resultPreview || null;
  const callId = segment.presentation?.callId ?? null;
  return {
    title: "Read output",
    copyText: output,
    body: (state) =>
      output && isDefault(state) ? (
        <ItemCodeField title="Output" shortContent={output} source="output" callId={callId} />
      ) : null,
  };
}
