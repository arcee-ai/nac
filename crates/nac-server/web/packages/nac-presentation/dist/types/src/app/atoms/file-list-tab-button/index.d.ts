import type React from "react";
import { type GitStatus } from "../git-status-label";
/** The design's RWD: Small is the desktop row, Large the phone's touch row. */
export declare enum FileListTabButtonSize {
    Small = "small",
    Large = "large"
}
export declare enum FileListTabButtonVariant {
    File = "file",
    Folder = "folder"
}
interface FileListTabButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
    ref?: React.Ref<HTMLButtonElement>;
    /** The row's text: a file's name, or a folder's (a merged chain keeps its slashes). */
    name: string;
    /** Picks a file's type icon; defaults to the name. */
    path?: string;
    variant?: FileListTabButtonVariant;
    size?: FileListTabButtonSize;
    /**
     * The design's `GH State`. It tints the name through every state; a file
     * adds the status letter, a folder tints its chevron instead.
     */
    status?: GitStatus | null;
    /** The design's `isActive`: the file that is open, or a folder that is expanded. */
    active?: boolean;
}
/**
 * A row of the Files panel's list: a file with its type icon, or a folder with
 * a chevron that turns once it is open. A git status keeps its colour on the
 * name whatever the row's state, so hovering or opening a file never washes it
 * out; a disabled row dims that colour rather than greying it.
 *
 * Only a file is ever highlighted. A folder's `active` opens it, which the
 * chevron shows, and reaches assistive technology as `aria-expanded`; a file's
 * is `aria-pressed`.
 */
declare const FileListTabButton: React.FC<FileListTabButtonProps>;
export default FileListTabButton;
