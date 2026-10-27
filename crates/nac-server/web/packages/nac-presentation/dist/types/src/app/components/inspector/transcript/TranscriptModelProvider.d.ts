import { type ReactNode } from "react";
import type { SessionSnapshotResponse } from "../../../types/api";
/**
 * Derives the session's transcript model once for the whole page, so the chat
 * and Insights read the same turns. Its own component: stream deltas re-render
 * it and the readers of the model, not the page that renders it — nor the rows,
 * which read their neighbours from the turns the stream leaves alone.
 */
export declare function TranscriptModelProvider({ sessionId, snapshot, children, }: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    children: ReactNode;
}): import("react").JSX.Element;
