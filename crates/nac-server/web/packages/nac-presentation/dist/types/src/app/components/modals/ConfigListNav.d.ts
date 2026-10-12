/**
 * Sidebar that picks a saved setup (or the draft row). On a phone there is no
 * room for the column, so the same rows open from a popover instead of a
 * horizontal strip.
 */
export declare function ConfigListNav({ draftLabel, draftSelected, onSelectDraft, entries, selectedId, onSelect, isLoading, }: {
    draftLabel: string;
    draftSelected: boolean;
    onSelectDraft: () => void;
    entries: {
        id: string;
        name: string;
    }[];
    selectedId: string;
    onSelect: (id: string) => void;
    isLoading?: boolean;
}): import("react").JSX.Element;
