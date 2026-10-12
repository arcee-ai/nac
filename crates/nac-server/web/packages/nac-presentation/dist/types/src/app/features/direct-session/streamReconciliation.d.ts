import { Context, Effect, Scope } from "effect";
/** Canonical consequences of a delivered event, projected by the browser adapter. */
export interface SessionChange {
    refresh: "none" | "messages" | "snapshot" | "replace-snapshot";
    transcriptLength: number;
    finishedThread?: string;
    runCompleted: boolean;
    permissionsChanged: boolean;
}
/** Application-owned observation capabilities; cache and wire types stay at the edge. */
export interface ObservationPorts {
    attach: () => void;
    detach: () => void;
    subscribe: (callbacks: {
        change: (change: SessionChange) => void;
        epoch: (epoch: string) => void;
        replayLost: () => void;
    }) => () => void;
    fenceSnapshot: (replace: boolean) => void;
    snapshot: () => Promise<void>;
    tail: (signal: AbortSignal) => Promise<{
        kind: "accepted";
        total: number;
    } | {
        kind: "obsolete";
    } | {
        kind: "snapshot-required";
    }>;
    invalidate: (kind: "permissions" | "skills" | "revisions" | "thread", thread?: string) => void;
}
declare const SessionObservation_base: Context.TagClass<SessionObservation, "nac/SessionObservation", ObservationPorts>;
/** The composition root supplies the existing browser capabilities for one activation. */
export declare class SessionObservation extends SessionObservation_base {
}
/** A scoped observation lease. Closing it never cancels a durable run. */
export interface ObservationLease {
    close: () => void;
}
/**
 * Own burst coalescing, snapshot priority, replay recovery, and read/resource release.
 * The typed client still owns ordered delivery/reconnect; TanStack owns the cache.
 */
export declare const observeSession: Effect.Effect<ObservationLease, never, SessionObservation | Scope.Scope>;
export {};
