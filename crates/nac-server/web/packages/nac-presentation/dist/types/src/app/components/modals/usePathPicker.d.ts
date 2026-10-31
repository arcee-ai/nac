import { type BrowseKind } from "../../services/queries";
import type { SshTarget } from "../../types/api";
interface PathPickerOptions {
    open: boolean;
    kind: BrowseKind;
    initialPath: string;
    ssh: SshTarget | null;
    showHidden: boolean;
    onSelect: (path: string) => void;
}
/** A Select the server refused, kept beside the draft it was made from. */
export interface SelectFailure {
    path: string;
    error: Error;
}
interface BoundFailure extends SelectFailure {
    epoch: number;
}
/**
 * State for one open path picker: the listed directory, the editable draft
 * above it, and Select.
 *
 * When picking a directory, the draft the user can see is what Select applies.
 * It goes to the server through the same listing query Enter navigates with —
 * the server expands `~`, canonicalizes, and refuses what is missing, not a
 * directory, or unreadable — and only the path the server resolved is handed
 * to `onSelect`. Nothing is created, and no client-side path rule is applied.
 *
 * An answer is applied only to the Select that asked for it: editing the
 * draft, navigating elsewhere, switching source, closing or unmounting the
 * picker all supersede a pending check, and its late answer is dropped.
 * File pickers keep choosing a listed file, as before.
 */
export declare function usePathPicker({ open, kind, initialPath, ssh, showHidden, onSelect, }: PathPickerOptions): {
    /** Identifies this opening and source; answers made under another are stale. */
    binding: string;
    pickingFile: boolean;
    directory: string;
    draft: string;
    setDraft: (value: string) => void;
    goTo: (path: string) => void;
    file: string | null;
    chooseFile: import("react").Dispatch<import("react").SetStateAction<string | null>>;
    hidden: boolean;
    toggleHidden: () => void;
    listing: import("@tanstack/react-query").UseQueryResult<NoInfer<{
        entries: import("../../types/openapi.generated").components["schemas"]["BrowseEntry"][];
        home?: string | null;
        parent?: string | null;
        path: string;
        truncated: boolean;
    }>, Error>;
    chosen: string | null;
    select: () => void;
    /** The path a Select is waiting on the server for, if any. */
    checking: string | null;
    failure: BoundFailure | null;
};
export {};
