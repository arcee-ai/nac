import type { ActiveRunSnapshot } from "../types/api";
/** Bind React activation to the scoped session observation workflow. */
export declare function useSessionStream(sessionId: string | null): void;
/**
 * Keep a delegated child's approval channel live from its parent chat without
 * applying that child's runtime events to the parent's transcript store.
 */
export declare function useDelegatedPermissionStream(sessionId: string, enabled: boolean): void;
/**
 * Reconcile the live running flag with the snapshot, so a reload during a run
 * does not show the session as idle until the next event arrives.
 */
export declare function useRunStateSync(activeRun: ActiveRunSnapshot | null | undefined): void;
