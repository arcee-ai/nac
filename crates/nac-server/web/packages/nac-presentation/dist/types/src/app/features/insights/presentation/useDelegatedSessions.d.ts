import type { DelegatedRowKey, InsightSegment, InsightTurnSection } from "../model/types";
import type { SessionSnapshotResponse } from "../../../types/api";
/** A delegated session this session's own records vouch for. */
export interface SessionLink {
    rowKey: DelegatedRowKey;
    title: string;
}
export type SessionResolver = (rowKey: DelegatedRowKey | null) => SessionLink | null;
/** The session a session tool addressed; its preview is the id the model passed. */
export declare function sessionTarget(segment: InsightSegment): DelegatedRowKey | null;
/**
 * Ids in tool calls are the model's to choose, so a session is only named or
 * linked once the delegation records of this session list it.
 */
export declare function useDelegatedSessions(sessionId: string, snapshot: SessionSnapshotResponse | null, timeline: readonly InsightTurnSection[]): SessionResolver;
