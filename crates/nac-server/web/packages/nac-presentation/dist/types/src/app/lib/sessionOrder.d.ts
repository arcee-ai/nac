import type { ManagedSessionSummary, ReorderSessionsRequest, SessionSummarySnapshot } from "../types/api";
export type DropEdge = "before" | "after";
/** Insert `id` at `index` in `ids`, removing any prior occurrence. */
export declare function placeIdAt(ids: string[], id: string, index: number): string[];
/**
 * Lay `entries` out in the order the user dragged the tabs into.
 *
 * Chats started since that arrangement are not in it, and go to the front,
 * where the untouched newest-first order would have put them anyway.
 */
export declare function applyTabOrder(entries: ManagedSessionSummary[], order: readonly string[]): ManagedSessionSummary[];
export declare function compareSortOrder(a: SessionSummarySnapshot, b: SessionSummarySnapshot): number;
/** Full pin-group membership in backend order (required by `/sessions/order`). */
export declare function pinGroup(entries: ManagedSessionSummary[], pinned: boolean): ManagedSessionSummary[];
export declare function reorderRequest(pinned: boolean, sessionIds: string[], entries: ManagedSessionSummary[]): ReorderSessionsRequest;
/**
 * After a pin/unpin, the returned summary carries the new version; patch it
 * into the list used for the follow-up reorder.
 */
export declare function withUpdatedSummary(entries: ManagedSessionSummary[], summary: SessionSummarySnapshot): ManagedSessionSummary[];
/** Drop before/after a visible card → index in the full pin group. */
export declare function targetIndexInGroup(group: ManagedSessionSummary[], targetSessionId: string, edge: DropEdge, movingSessionId: string): number;
/** True when the move would not change pin group membership or order. */
export declare function isNoOpMove(sessions: ManagedSessionSummary[], sessionId: string, targetPinned: boolean, targetIndex: number): boolean;
export declare function sameOrder(a: string[], b: string[]): boolean;
