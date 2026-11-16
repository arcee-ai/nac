/**
 * Current wall-clock time, refreshed every `intervalMs`. Pick the coarsest
 * resolution that still looks right: one second for run timers, a minute for
 * relative-time filters. Pass `enabled: false` to stop ticking entirely, which
 * keeps idle session cards from re-rendering every second.
 */
export declare function useNow(intervalMs?: number, enabled?: boolean): number;
