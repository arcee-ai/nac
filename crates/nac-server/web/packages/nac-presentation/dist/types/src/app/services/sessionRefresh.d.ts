export interface SnapshotFetchToken {
    generation: number;
    replace: boolean;
}
export interface TailFetchToken {
    generation: number;
    controller: AbortController;
}
/** Bind refresh state to its cache/endpoint lifetime without changing wire IDs. */
export declare function sessionRefreshKey(owner: object, sessionId: string): string;
/** Fence every page read before a canonical snapshot is requested. */
export declare function fenceSessionSnapshot(sessionId: string, replace?: boolean): number;
/** Start a canonical fetch without consuming a destructive replacement. */
export declare function beginSnapshotFetch(sessionId: string): SnapshotFetchToken;
/** Consume replacement state only after the matching snapshot was accepted. */
export declare function finishSnapshotFetch(sessionId: string, token: SnapshotFetchToken): void;
export declare function beginTailFetch(sessionId: string): TailFetchToken;
export declare function finishTailFetch(sessionId: string, token: TailFetchToken): void;
export declare function isCurrentSessionGeneration(sessionId: string, generation: number): boolean;
/** Historical pages share the canonical fence and release with their view. */
export declare function beginHistoryFetch(sessionId: string): TailFetchToken;
export declare function finishHistoryFetch(sessionId: string, token: TailFetchToken): void;
export declare function currentSessionGeneration(sessionId: string): number;
export declare function disposeSessionRefresh(sessionId: string): void;
