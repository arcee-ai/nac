/** The tokens the menu can start in the field; each opens its own suggestions. */
export type ComposerToken = "/" | "$" | "!";
export interface ComposerMenuProps {
    sessionId: string;
    compact: boolean;
    /** Goals, shell commands and terminal attachments exist only in direct sessions. */
    direct: boolean;
    /** A token that replaces the field (`/`, `!`) needs an empty field. */
    fieldEmpty: boolean;
    disabled: boolean;
    onInsert: (token: ComposerToken) => void;
    onGoal: () => void;
    /** Opens the terminal, where a reviewed selection is attached to a message. */
    onAttachSelection: (() => void) | null;
}
/**
 * The composer's `+`: the things that can go into a message besides text —
 * slash commands, skills, a shell command, the session goal, and terminal
 * output. Each starts the field's own machinery rather than duplicating it.
 */
export declare function ComposerMenu({ sessionId, compact, direct, fieldEmpty, disabled, onInsert, onGoal, onAttachSelection, }: ComposerMenuProps): import("react").JSX.Element;
