import { type ReactNode } from "react";
/** Initial focus and Tab navigation; the presentation layer owns dismissal and focus return. */
export declare function PopoverFocusScope({ open, label, children, }: {
    open: boolean;
    label: string;
    children: ReactNode;
}): import("react").JSX.Element;
