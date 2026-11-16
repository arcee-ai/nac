import { type ReactNode } from "react";
/** Presentation only: field state, validation and actions stay with the caller. */
export declare function FormSection({ title, description, action, children, className, }: {
    title: string;
    description?: string;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}): import("react").JSX.Element;
