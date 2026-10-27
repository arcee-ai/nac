import { type ItemContent, type ItemContext, type ToolSegment } from "./itemContent";
/**
 * Read, create and edit show the file as a button that opens it in Files. A
 * create or edit also shows its own diff, which its result carries.
 */
export declare function fileContent(segment: ToolSegment, context: ItemContext): ItemContent;
