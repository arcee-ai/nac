import type { SessionSnapshotResponse } from "../../types/api";
/** Structured plans attached to the session: the list, and one plan in full. */
export declare function WorksetsView({ snapshot, selected, onSelect, }: {
    snapshot: SessionSnapshotResponse | null;
    /** Workset the chat pointed at, if any. */
    selected: string | null;
    onSelect: (id: string) => void;
}): import("react").JSX.Element;
