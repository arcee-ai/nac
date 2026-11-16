import { type ItemContent, type ItemContext, type ToolSegment } from "./itemContent";
/** No favicons: the detail never loads anything from the sites it names. */
export declare function webContent(segment: ToolSegment, context: ItemContext): ItemContent;
export declare function fileSearchContent(segment: ToolSegment, context: ItemContext): ItemContent;
