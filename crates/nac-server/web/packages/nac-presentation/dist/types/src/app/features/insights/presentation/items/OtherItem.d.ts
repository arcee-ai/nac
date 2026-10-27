import { type ItemContent, type ItemContext, type ToolSegment } from "./itemContent";
/**
 * Unknown and MCP tools rarely have a key-argument preview, so their input
 * field can hold "Show full" alone.
 */
export declare function otherContent(segment: ToolSegment, context: ItemContext): ItemContent;
