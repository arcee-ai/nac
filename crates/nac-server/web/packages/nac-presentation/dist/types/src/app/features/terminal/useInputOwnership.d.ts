import type { ExecutionStatus } from "../../../../packages/nac-client/src/index.js";
export declare const inputOwnershipKey: (session: string, id: string) => readonly ["session", string, "execution", string, "input-control"];
export declare function mayOfferInputControl(source: ExecutionStatus | undefined, readonly: boolean): boolean;
/** Current control is independent of immutable output frames and provenance. */
export declare function useInputOwnership(session: string, source: ExecutionStatus, readonly: boolean): {
    offered: boolean;
    state: NoInfer<{
        controller: import("../../../../packages/nac-client/src/openapi.generated.js").components["schemas"]["InputController"];
        frozen: boolean;
        in_flight: boolean;
        revision: string;
    }> | undefined;
    loading: boolean;
    unavailable: boolean;
    pending: boolean;
    error: Error | null;
    change: import("@tanstack/react-query").UseMutateAsyncFunction<{
        controller: import("../../../../packages/nac-client/src/openapi.generated.js").components["schemas"]["InputController"];
        frozen: boolean;
        in_flight: boolean;
        revision: string;
    }, Error, {
        controller: "human" | "agent";
        acknowledge?: boolean;
    }, unknown>;
    refresh: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        controller: import("../../../../packages/nac-client/src/openapi.generated.js").components["schemas"]["InputController"];
        frozen: boolean;
        in_flight: boolean;
        revision: string;
    }>, Error>>;
};
