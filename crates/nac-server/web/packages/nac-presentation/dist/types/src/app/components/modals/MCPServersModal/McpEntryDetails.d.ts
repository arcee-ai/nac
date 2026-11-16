import type { McpLibraryEntry } from "../../../types/api";
/**
 * The entry's icon when it has one and it loads; its first letter otherwise.
 */
export declare function EntryThumbnail({ entry }: {
    entry: McpLibraryEntry;
}): import("react").JSX.Element;
/**
 * The catalog entry's identity and description as a card: thumbnail, name,
 * category, auth badge, docs link, and the description clamped to three
 * lines with a toggle when it overflows.
 */
export declare function EntryDetails({ entry }: {
    entry: McpLibraryEntry;
}): import("react").JSX.Element;
