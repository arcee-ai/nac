import type { SessionSnapshotResponse, WorkspaceFileList } from "../../types/api";
export interface RevealSelection {
    sessionId: string;
    selectedRoot: string;
    pathRoot: string;
    path: string;
}
/** The runtime's private cache shares a selection with the full-screen Files
 * panel. Refreshing a listing cannot reinterpret an already selected identity. */
export declare function useRevealSelection({ sessionId, snapshot, listing, selected, current, active, }: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    listing: WorkspaceFileList | undefined;
    selected: string | null;
    current: string | null;
    active: boolean;
}): {
    origin: NonNullable<NoInfer<RevealSelection | null>> | null;
    selectFile: (path: string) => void;
};
