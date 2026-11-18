import type { ProjectRecord, SessionBehavior } from "../../types/api";
/** Which project the new session runs in, plus "Add project…". */
export declare function ProjectPicker({ projects, value, onChange, onAddProject, addLabel, disabled, }: {
    projects: readonly ProjectRecord[];
    value: ProjectRecord | null;
    onChange: (projectId: string) => void;
    onAddProject: () => void;
    addLabel: string;
    disabled?: boolean;
}): import("react").JSX.Element;
/** Agent / Agent + Orchestrator / Orchestrator. Behavior is fixed per session. */
export declare function BehaviorPicker({ value, onChange, disabled, }: {
    value: SessionBehavior;
    onChange: (behavior: SessionBehavior) => void;
    disabled?: boolean;
}): import("react").JSX.Element;
/**
 * Where the session works: the project's own folder, or a new retained Git
 * checkout that leaves the working tree untouched. The checkout needs a direct
 * agent on a Local Git project, so it is offered only when `available`.
 */
export declare function WorkspacePicker({ isolated, available, onChange, disabled, }: {
    isolated: boolean;
    available: boolean;
    onChange: (isolated: boolean) => void;
    disabled?: boolean;
}): import("react").JSX.Element;
/**
 * The ref an isolated checkout starts from. A typed branch, tag or commit
 * wins; otherwise it is the project's saved default branch.
 */
export declare function RefPicker({ value, defaultRef, onChange, disabled, }: {
    value: string;
    defaultRef: string | null;
    onChange: (ref: string) => void;
    disabled?: boolean;
}): import("react").JSX.Element;
