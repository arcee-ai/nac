import type { ItemContext } from "./itemContent";
interface ItemFileButtonProps {
    /** As the model wrote it: absolute, relative to the session's directory, or cut short. */
    path: string;
    context: ItemContext;
    additions?: number | null;
    deletions?: number | null;
}
/**
 * The design's FilesButtonWrapper: the file a call names, as a button that
 * opens it in Files. A path that maps onto no workspace file leaves the button
 * disabled, with the reason as its tooltip.
 */
export declare function ItemFileButton({ path, context, additions, deletions }: ItemFileButtonProps): import("react").JSX.Element;
export {};
