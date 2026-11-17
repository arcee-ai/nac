import { type FleetAttentionState } from "./fleetAttentionModel";
export * from "./fleetAttentionModel";
export type FleetAttentionStatus = "connecting" | "live" | "polling" | "unavailable";
export type FleetEventSourceFactory = (path: string) => Promise<EventSource> | EventSource;
export interface FleetAttentionOptions {
    projectId?: string;
    pollMs?: number;
    enabled?: boolean;
    /** Test/adapter seam; defaults to the runtime's authenticated stream. */
    eventSource?: FleetEventSourceFactory;
}
export interface FleetAttentionResult extends FleetAttentionState {
    status: FleetAttentionStatus;
}
export declare function useFleetAttention(options?: FleetAttentionOptions): FleetAttentionResult;
