import type { ChangedFileStat } from "../../types/api";
/**
 * The files a snapshot touched, each opening in the files panel. Sits above the
 * snapshot badge so the turn says what it changed before it says how much.
 */
export declare function SnapshotFiles({ files, selected, onOpen, onOpenAll, }: {
    files: ChangedFileStat[];
    /** Path the files panel is pointing at, when that panel is the open one. */
    selected: string | null;
    onOpen: (path: string) => void;
    /** Falls back to the panel for whatever did not fit here. */
    onOpenAll: () => void;
}): import("react").JSX.Element | null;
