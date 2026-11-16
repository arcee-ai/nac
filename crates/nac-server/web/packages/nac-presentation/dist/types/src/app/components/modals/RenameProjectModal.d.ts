import type { ProjectRecord } from "../../types/api";
/** Mounted only while open, so the fields start from the current record. */
export declare function RenameProjectModal({ open, onClose, project, }: {
    open: boolean;
    onClose: () => void;
    project: ProjectRecord | null;
}): import("react").JSX.Element | null;
