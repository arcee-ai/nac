import type { ProjectListKind, ProjectReorderStart } from "../../components/projects/ProjectCard";
import { type DropEdge } from "../../lib/sessionOrder";
import type { ManagedSessionSummary, ProjectRecord } from "../../types/api";
export interface DropTarget {
    itemId: string;
    edge: DropEdge;
}
export interface DragState {
    itemId: string;
    kind: ProjectListKind;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    x: number;
    y: number;
}
/** Projects of one pin group, in the order the backend keeps them. */
export declare function pinnedGroup(projects: readonly ProjectRecord[], pinned: boolean): ProjectRecord[];
/**
 * Pointer-driven reorder of Home's project tiles (HTML5 DnD cancelled when the
 * source re-rendered), plus keyboard/arrow moves, pin-by-drop and
 * drop-to-assign for unassigned sessions. Same commands as before: the
 * project/session order mutations and the project assign action.
 */
export declare function useProjectReorder(projects: readonly ProjectRecord[], sessions: readonly ManagedSessionSummary[]): {
    drag: DragState | null;
    dropTarget: DropTarget | null;
    pinZoneActive: boolean;
    beginDrag: (start: ProjectReorderStart) => void;
    moveByArrow: (project: ProjectRecord, delta: -1 | 1) => void;
    moveOrphanByArrow: (sessionId: string, delta: -1 | 1) => void;
    fullPinned: {
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }[];
    fullUnpinned: {
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }[];
    fullOrphans: {
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[];
};
