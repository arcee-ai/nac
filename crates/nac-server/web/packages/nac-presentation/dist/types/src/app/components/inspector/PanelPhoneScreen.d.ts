import type { ReactNode } from "react";
/**
 * One screen of the side box on a phone: a list of rows, or the row opened
 * from it. Its header floats over the content the way the dialog header does
 * elsewhere on a phone, so scrollers start 56px down and run under the fade.
 *
 * A list screen leaves the dialog through its back button and keeps the panel
 * tab bar over its last rows; an opened row goes back to its list instead.
 */
export declare function PanelPhoneScreen({ title, titleAction, actions, back, bar, children, }: {
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
    children: ReactNode;
}): import("react").JSX.Element;
