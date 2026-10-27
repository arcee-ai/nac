import type React from "react";
export declare enum FileButtonSize {
    Small = "small",
    Medium = "medium",
    Large = "large"
}
interface FileButtonProps {
    ref?: React.Ref<HTMLButtonElement>;
    /** Picks the icon and is shown whole in the tooltip. */
    path: string;
    /** Defaults to the path's base name. */
    label?: string;
    size?: FileButtonSize;
    /** The design's `isActive`: highlights the file that is open, for example. */
    active?: boolean;
    disabled?: boolean;
    /** Either count adds the change badge after the label. */
    additions?: number | null;
    deletions?: number | null;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    className?: string;
}
/**
 * A file as a ghost button: its type icon, its name and, when known, how many
 * lines the change added and removed. The name truncates with an ellipsis
 * once the button runs out of room; the icon and the counts keep their width.
 * It is as wide as its content, so a caller that lines several up stretches
 * it with `w-full`.
 *
 * The accessible name is the label followed by the spelled-out counts
 * ("index.tsx, 279 additions, 84 deletions"), so it starts with the visible
 * text, and the full path in the tooltip becomes its description. The focus
 * ring is the one `.btn:focus-visible` draws for every other button.
 */
declare const FileButton: React.FC<FileButtonProps>;
export default FileButton;
