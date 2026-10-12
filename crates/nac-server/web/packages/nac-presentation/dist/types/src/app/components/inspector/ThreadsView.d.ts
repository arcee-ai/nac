import type { SessionSnapshotResponse } from "../../types/api";
/**
 * Retained workstreams and their episodes, merged with the live SSE state so a
 * running thread shows the commands it is issuing before any episode is
 * persisted — and before the thread itself has a row in the store.
 */
export declare function ThreadsView({ snapshot, selected, onSelect, canSteerWorkers, }: {
    snapshot: SessionSnapshotResponse | null;
    /** Thread the chat pointed at, if any. */
    selected: string | null;
    onSelect: (name: string) => void;
    /** True only for the user-owned primary classic orchestrator transcript. */
    canSteerWorkers: boolean;
}): import("react").JSX.Element;
