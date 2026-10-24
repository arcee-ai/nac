import { actionTypeLabel } from "@/app/features/insights/model/labels";
import { ItemCodeField } from "@/app/features/insights/presentation/items/ItemCodeField";
import {
  isDefault,
  showsInput,
  withDuration,
  type ItemContent,
  type ItemContext,
  type ToolSegment,
} from "@/app/features/insights/presentation/items/itemContent";
import { BodyText } from "@/app/features/insights/presentation/items/ItemParts";

/** No favicons: the detail never loads anything from the sites it names. */
export function webContent(segment: ToolSegment, context: ItemContext): ItemContent {
  const input = segment.presentation?.summary || null;
  const result = segment.presentation?.resultPreview || null;
  const callId = segment.presentation?.callId ?? null;
  // The design draws a fetch without an input field; its URL keeps one, unheaded.
  const search = segment.action === "web-search";
  return {
    title: withDuration(actionTypeLabel(segment.action), segment.presentation?.durationMs),
    copyText: input,
    body: (state) => (
      <>
        {input && showsInput(state) ? (
          <ItemCodeField
            title={search ? "Search Input" : "Input"}
            showHeading={search}
            shortContent={input}
            source="arguments"
            sessionId={context.sessionId}
            callId={callId}
          />
        ) : null}
        {result && isDefault(state) ? <BodyText>{result}</BodyText> : null}
      </>
    ),
  };
}

export function fileSearchContent(segment: ToolSegment, context: ItemContext): ItemContent {
  const pattern = segment.presentation?.summary || null;
  const matches = segment.presentation?.resultPreview || null;
  const callId = segment.presentation?.callId ?? null;
  return {
    title: actionTypeLabel(segment.action),
    copyText: pattern,
    body: (state) => (
      <>
        {pattern && showsInput(state) ? (
          <ItemCodeField
            title="Input"
            shortContent={pattern}
            source="arguments"
            sessionId={context.sessionId}
            callId={callId}
          />
        ) : null}
        {matches && isDefault(state) ? (
          <ItemCodeField
            title="Output"
            shortContent={matches}
            source="output"
            sessionId={context.sessionId}
            callId={callId}
          />
        ) : null}
      </>
    ),
  };
}
