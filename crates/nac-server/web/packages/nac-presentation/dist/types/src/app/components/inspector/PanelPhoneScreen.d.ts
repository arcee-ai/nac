import type { ReactNode } from "react";
/**
 * One screen of the side box on a phone: a list of rows, or the row opened
 * from it. Its header defaults to floating over content, with 56px scroller
 * clearance. Selected child and Files list owners can reserve an in-flow
 * header instead; Files actions wrap below the title above the scroller.
 *
 * A list screen leaves the dialog through its back button and keeps the panel
 * tab bar over its last rows; an opened row goes back to its list instead.
 */
export declare function PanelPhoneScreen({ title, titleAction, actions, back, bar, headerInFlow, actionsBelowTitle, children, }: {
    title: ReactNode;
    /** Belongs to the title itself, beside it rather than trailing. */
    titleAction?: ReactNode;
    /** The screen's own controls, trailing the header. */
    actions?: ReactNode;
    /** Where the leading button leads. Omitted, it closes the dialog. */
    back?: {
        label: string;
        onClick: () => void;
    };
    bar?: boolean;
    /** Opt-in for selected child detail or a Files list's wrapping controls. */
    headerInFlow?: boolean;
    /** Files use a full row; selected child actions wrap only in a narrow container. */
    actionsBelowTitle?: boolean | "narrow";
    children: ReactNode;
}): import("react").JSX.Element;
