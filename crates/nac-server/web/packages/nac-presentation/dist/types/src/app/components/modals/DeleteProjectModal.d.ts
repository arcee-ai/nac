import type { ProjectRecord } from "../../types/api.js";
export declare function DeleteProjectModal({ open, onClose, project, }: {
    open: boolean;
    onClose: () => void;
    project: ProjectRecord | null;
}): import("react").JSX.Element;
