import type { ItemContext } from "./itemContent";
import { type ToolCallRef } from "../../../../services/queries/toolCalls";
interface FileChangeProps {
    /** `presentation.summary`: as the model wrote it, or cut short. */
    path: string | null;
    call: ToolCallRef;
    context: ItemContext;
}
/**
 * A finished write or edit: its file button with the lines the call added and
 * removed, then the call's own diff. Both come from the call's result, which
 * loads once the change is on screen.
 */
export declare function FileChange({ path, call, context }: FileChangeProps): import("react").JSX.Element;
export {};
