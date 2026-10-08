import { type ReactNode } from "react";
import type { TraditionalChildStatus } from "../../types/api";
export interface SubagentChatInputBoxProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onStop: () => void;
    running: boolean;
    /** Foreground runs keep the switch off and say "Regular run" while they work. */
    background: boolean;
    onBackgroundChange: (background: boolean) => void;
    status?: TraditionalChildStatus | null;
    busy?: boolean;
    permission?: ReactNode;
    /** Put the caret in the field once this composer is shown. */
    autoFocus?: boolean;
    /** Changes whenever a new launch should take the caret again. */
    focusRequest?: number;
}
/**
 * The short composer under a child transcript and inside the Subagents preview.
 * It sends, steers, or stops. It does not carry the parent composer's model,
 * effort, or goal controls.
 */
export declare function SubagentChatInputBox({ value, onChange, onSubmit, onStop, running, background, onBackgroundChange, status, busy, permission, autoFocus, focusRequest, }: SubagentChatInputBoxProps): import("react").JSX.Element;
