import { type ReactNode } from "react";
/** Opt-in keyboard ownership for actions portaled outside an enclosing dialog. */
export declare function PopoverFocusScope({ open, label, onClose, children, }: {
    open: boolean;
    label: string;
    onClose?: () => void;
    children: ReactNode;
}): import("react").JSX.Element;
