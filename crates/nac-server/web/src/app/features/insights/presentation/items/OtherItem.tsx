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

/**
 * Unknown and MCP tools rarely have a key-argument preview, so their input
 * field can hold "Show full" alone.
 */
export function otherContent(segment: ToolSegment, context: ItemContext): ItemContent {
  const input = segment.presentation?.summary || null;
  const output = segment.presentation?.resultPreview || null;
  const call = segmentCall(segment);
  return {
    title: segmentTitle(segment),
    copyText: input ?? output,
    body: (state) => (
      <>
        {(input || call) && showsInput(state) ? (
          <ItemCodeField
            title="Input"
            shortContent={input ?? ""}
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
