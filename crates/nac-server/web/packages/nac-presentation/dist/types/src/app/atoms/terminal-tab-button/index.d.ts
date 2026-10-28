import type React from "react";
/** The design's RWD: Small is the desktop and tablet row, Large the phone's touch row. */
export declare enum TerminalTabButtonSize {
    Small = "small",
    Large = "large"
}
interface TerminalTabButtonProps {
    /** The terminal's name. */
    label: string;
    /** The design's `owner: Agent` tag: the agent runs the terminal or holds its input. */
    agent?: boolean;
    /** Spoken after the name and the tag, never drawn: the row's process state. */
    description?: string;
    size?: TerminalTabButtonSize;
    /** The design's `isActive`: the terminal that is open. */
    active?: boolean;
    disabled?: boolean;
    /** Full text for a pointer, when the label truncates. */
    title?: string;
    onClick?: () => void;
    /**
     * The design's trailing trash. A desktop row shows it on hover; a phone has
     * no hover, so its row always does.
     */
    remove?: {
        label: string;
        onClick: () => void;
        disabled?: boolean;
    };
    className?: string;
}
/**
 * A row of the Terminal panel's list. The row is one control that opens the
 * terminal, with the trash beside it as a second, so the two never nest; the
 * opening control stretches under the whole row and the trash sits above it.
 *
 * The row draws the focus ring for its opening control, as the design does,
 * and the trash draws its own.
 */
declare const TerminalTabButton: React.FC<TerminalTabButtonProps>;
export default TerminalTabButton;
