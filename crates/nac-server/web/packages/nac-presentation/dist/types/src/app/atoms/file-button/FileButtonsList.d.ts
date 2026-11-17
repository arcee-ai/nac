import type React from "react";
import { FileButtonSize } from "./index";
export interface FileButtonsListFile {
    path: string;
    /** Defaults to the path's base name. */
    label?: string;
    additions?: number | null;
    deletions?: number | null;
    active?: boolean;
    disabled?: boolean;
}
interface FileButtonsListProps {
    files: FileButtonsListFile[];
    size?: FileButtonSize;
    onOpen: (path: string) => void;
    /**
     * Most rows drawn before the rest is asked for, "+N more" included: a
     * longer list shows `limit - 1` files and the button.
     */
    limit?: number;
    "aria-label"?: string;
    className?: string;
}
/**
 * Files stacked 4px apart, each button stretched to the list's width with its
 * content on the left. A long list stops at `limit` rows with a ghost
 * "+N more" button that reveals the rest in place and hands its focus to the
 * first revealed file that can take it, or to the list when none can.
 * Assistive technology hears a list of the files shown, followed by the button.
 */
declare const FileButtonsList: React.FC<FileButtonsListProps>;
export default FileButtonsList;
