import { type FileListing } from "../../store/sessionLayoutStore";
import type { ChangedFileStat } from "../../types/api";
/**
 * Which checkout the panel describes: the working tree against HEAD, or what
 * one finished run changed. Choosing a snapshot here opens the newest one
 * unless another is already selected; the session's revision picker and the
 * History panel share the same selection.
 */
export declare function FilesScopeToggle({ sessionId, revision, large, }: {
    sessionId: string;
    revision: number | null;
    large?: boolean;
}): import("react").JSX.Element | null;
/** How the files are listed, which changes they show, and the commit action. */
export declare function FilesListToolbar({ sessionId, listing, changed, revision, readOnly, reveal, }: {
    sessionId: string;
    listing: FileListing;
    changed: ChangedFileStat[];
    revision: number | null;
    readOnly: boolean;
    reveal?: import("react").ReactNode;
}): import("react").JSX.Element;
/**
 * The checkout's branch, atop a phone's file list: the session header that
 * carries it on a wider screen is not drawn there. A delegated session only
 * names its branch, the way that header does.
 */
export declare function FilesBranchRow({ sessionId, branch, readOnly, }: {
    sessionId: string;
    branch: string;
    readOnly: boolean;
}): import("react").JSX.Element;
