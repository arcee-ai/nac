import type { ProjectView as ProjectRecord } from "../../features/public-native/collectionViews.js";
export declare function DeleteProjectModal({ open, onClose, project, }: {
    open: boolean;
    onClose: () => void;
    project: ProjectRecord | null;
}): import("react").JSX.Element;
