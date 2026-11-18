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
/** One place sessions can run: this computer, or an SSH host its projects use. */
export interface ComposerLocation {
    host: string | null;
    projectCount: number;
}
/**
 * Where the new session runs. SSH belongs to a project, so each host here is
 * one the user's projects already use; picking a location moves the composer
 * to that location's most recent project.
 */
export declare function LocationPicker({ locations, value, onChange, onAddSsh, disabled, }: {
    locations: readonly ComposerLocation[];
    value: string | null;
    onChange: (host: string | null) => void;
    onAddSsh: () => void;
    disabled?: boolean;
}): import("react").JSX.Element;
