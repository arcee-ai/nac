import type { ProjectRecord, SessionBehavior } from "../../types/api";
/**
 * Which project the new session runs in. A project's host is part of it, so
 * the menu groups projects under where they run rather than offering the host
 * as a separate choice; SSH projects name their host on the chip.
 */
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
