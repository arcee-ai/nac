import type { ProjectRecord } from "../../types/api";
/** Which project the new session runs in, plus "Add project…". */
export declare function ProjectPicker({ projects, value, onChange, onAddProject, addLabel, disabled, }: {
    projects: readonly ProjectRecord[];
    value: ProjectRecord | null;
    onChange: (projectId: string) => void;
    onAddProject: () => void;
    addLabel: string;
    disabled?: boolean;
}): import("react").JSX.Element;
/** Starts an isolated checkout (direct + committed Git source) instead of the project folder. */
export declare function IsolatedToggle({ value, onChange, disabled, }: {
    value: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
}): import("react").JSX.Element;
