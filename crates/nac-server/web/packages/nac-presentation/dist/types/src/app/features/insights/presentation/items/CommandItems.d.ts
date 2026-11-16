import { type ItemContent, type ItemContext, type ToolSegment } from "./itemContent";
export declare function runCommandContent(segment: ToolSegment, context: ItemContext): ItemContent;
export declare function writeCommandContent(segment: ToolSegment, context: ItemContext): ItemContent;
export declare function readOutputContent(segment: ToolSegment, context: ItemContext): ItemContent;
