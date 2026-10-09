import type { SessionSummarySnapshot } from "../../types/api";
/**
 * Adopts a session that belongs to no project.
 *
 * A session keeps its own working directory and the backend refuses to file it
 * anywhere else, so there is no project to choose: either one already covers
 * this location, or the modal offers to create it.
 */
export declare function AssignToProjectModal({ open, onClose, summary, }: {
    open: boolean;
    onClose: () => void;
    summary: SessionSummarySnapshot | null;
}): import("react").JSX.Element;
