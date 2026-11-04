import { type QueryClient } from "@tanstack/react-query";
import type { NativeApi } from "../../services/api";
type RefreshTarget = {
    sessionId: string;
    revision: number;
    api: NativeApi;
    client: QueryClient;
};
export declare function useSessionIntegrations(sessionId: string, open: boolean): {
    status: import("@tanstack/react-query").UseQueryResult<NoInfer<{
        applied_revision: number | null;
        incarnation_id: string | null;
        message: string | null;
        requested_at: string | null;
        revision: number;
        state: import("../../types/openapi.generated").components["schemas"]["SessionMcpRefreshState"];
    }>, Error>;
    refresh: import("@tanstack/react-query").UseMutationResult<{
        applied_revision: number | null;
        incarnation_id: string | null;
        message: string | null;
        requested_at: string | null;
        revision: number;
        state: import("../../types/openapi.generated").components["schemas"]["SessionMcpRefreshState"];
    }, Error, RefreshTarget, unknown>;
    requestRefresh: (revision: number) => void;
};
export {};
