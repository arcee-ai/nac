import { type ReactNode } from "react";
/**
 * Picks a session behavior and starts it in the open project. With no project
 * on screen, the trigger falls through to creating one.
 */
export declare function NewSessionPopover({ projectId, onUnavailable, className, children, }: {
    projectId: string | null;
    onUnavailable: () => void;
    className?: string;
    children: (openMenu: () => void) => ReactNode;
}): import("react").JSX.Element;
