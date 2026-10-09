import type React from "react";
export declare enum ProjectButtonVariant {
    Project = "project",
    /** A session that belongs to no project; it gets a chat glyph, not a project. */
    Orphan = "orphan"
}
interface ProjectButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Seeds the identicon: a project id, or the session id for an orphan. */
    entityId: string;
    name: string;
    variant?: ProjectButtonVariant;
    active?: boolean;
    running?: boolean;
    /** Session count and similar, held at the row's end. */
    trailing?: React.ReactNode;
    /** Taller touch target and larger type for the mobile modal. */
    isMobile?: boolean;
    actions?: React.ReactNode;
}
/**
 * One project as a list row, shared by the project popover and the mobile modal.
 *
 * The row's end holds the session count until the pointer arrives, and the
 * controls then take that same place. Trading one for the other keeps the count
 * at the edge where it can be read down the column, which reserving room for
 * both would not.
 */
declare const ProjectButton: React.FC<ProjectButtonProps> & {
    Variant: typeof ProjectButtonVariant;
};
export default ProjectButton;
