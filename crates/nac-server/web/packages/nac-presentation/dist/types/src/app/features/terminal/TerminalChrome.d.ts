import { type ReactNode } from "react";
import { IconName } from "../../atoms";
import type { TerminalHeading } from "./terminalLabels";
export interface TerminalOption {
    label: string;
    icon: IconName;
    disabled?: boolean;
    onSelect: () => void;
}
/**
 * The detail of an open terminal: a desktop draws its header here, while a
 * narrower split draws the header itself and lends this its `menuSlot` for
 * the options. Everything the header's hint explains is also spoken.
 *
 * The output's scroller pads its own content rather than sitting inset, so
 * what scrolls runs to the frame's edges; on a phone, from the top of the
 * screen, under the floating header.
 */
export declare function TerminalFrame({ heading, menuSlot, options, notices, children, }: {
    heading: TerminalHeading;
    menuSlot: HTMLElement | null;
    /** Read when the menu opens, so its rows reflect the terminal at that moment. */
    options?: () => readonly TerminalOption[];
    notices?: readonly ReactNode[];
    /** Gets the top padding for the scroller, which depends on what is above it. */
    children: (top: string) => ReactNode;
}): import("react").JSX.Element;
/** The design's `Agent` tag after the title, and the hint explaining the terminal. */
export declare function TerminalTag({ heading, hint, }: {
    heading: TerminalHeading;
    hint?: boolean;
}): import("react").JSX.Element;
/**
 * A fact about the terminal that the design has no place for: a failure, or
 * the recovery it needs. Only the message is announced; its action follows.
 */
export declare function TerminalNotice({ children, info, live, action, }: {
    children: ReactNode;
    /** Informational rather than a failure. */
    info?: boolean;
    live?: "alert" | "status";
    action?: ReactNode;
}): import("react").JSX.Element;
/** The action a notice offers, sized for the notice it follows. */
export declare function NoticeAction({ children, disabled, onClick, }: {
    children: ReactNode;
    disabled?: boolean;
    onClick: () => void;
}): import("react").JSX.Element;
