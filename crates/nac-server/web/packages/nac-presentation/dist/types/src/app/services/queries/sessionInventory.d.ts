/** A deliberate, fresh passive inventory check, independently cancellable from observers. */
export declare function useFreshSessionInventory(binding: object): () => Promise<{
    active: boolean;
    active_run?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
    attention_revision?: number;
    attention_updated_at?: string | null;
    heartbeat_results?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
    lineage?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
    summary: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
    workspace_diff?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
}[]>;
