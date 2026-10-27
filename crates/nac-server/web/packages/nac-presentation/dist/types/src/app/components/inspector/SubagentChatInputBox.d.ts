import { type ReactNode } from "react";
export interface SubagentChatInputBoxProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onStop: () => void;
    running: boolean;
    /** Foreground runs keep the switch off and say "Regular run" while they work. */
    background: boolean;
    onBackgroundChange: (background: boolean) => void;
    busy?: boolean;
    /** A start is still pending: nothing more is sent until the target is running. */
    starting?: boolean;
    permission?: ReactNode;
    /**
     * Over a child transcript it floats on the faded ground, as the main
     * composer does. A panel already insets and backs it.
     */
    floating?: boolean;
}
/**
 * The short composer under a child transcript and inside the Subagents preview.
 * It sends, steers, or stops. It does not carry the parent composer's model,
 * effort, or goal controls.
 */
export declare function SubagentChatInputBox({ value, onChange, onSubmit, onStop, running, background, onBackgroundChange, busy, starting, permission, floating, }: SubagentChatInputBoxProps): import("react").JSX.Element;
