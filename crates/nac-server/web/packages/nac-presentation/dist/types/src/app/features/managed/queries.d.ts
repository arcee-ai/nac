import { type ManagedUpgradeSnapshot } from "./upgrade";
import type { BackendKind, ModelCatalog } from "../../types/api";
export declare const managedQueryKeys: {
    hostStatus: readonly ["managed-host-status"];
    github: readonly ["managed-github"];
    secrets: readonly ["managed-secrets"];
    auth: readonly ["managed-auth"];
    upgrade: readonly ["managed-upgrade"];
    providerModels: (backend: string, baseUrl?: string | null) => readonly ["managed-provider-models", string] | readonly ["managed-provider-models", string, string];
    providerModelsAll: readonly ["managed-provider-models"];
};
export declare function useManagedHostStatus(): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    build_id: string;
    build_track: string;
    checks: import("../../types/openapi.generated").components["schemas"]["ReadinessCheck"][];
    github_status: string;
    logical_host_id: string;
    maintenance?: null | import("../../types/openapi.generated").components["schemas"]["ManagedMaintenanceSnapshot"];
    maintenance_state: string;
    managed: boolean;
    migration_failure?: string | null;
    migration_state: string;
    minimum_migratable_schema_version: number;
    model: import("../../types/openapi.generated").components["schemas"]["ManagedModelStatus"];
    model_ready: boolean;
    opened_schema_version?: number | null;
    owner?: string | null;
    product_version: string;
    project_count: number;
    public_hostname: string;
    ready: boolean;
    repository_root: string;
    schema_version: number;
    secret_count: number;
    session_count: number;
    source_revision: string;
    supported_schema_version: number;
    version: string;
}>, Error>;
export declare function useManagedUpgradeSnapshot(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<ManagedUpgradeSnapshot>, Error>;
export declare function useStartManagedUpgrade(): import("@tanstack/react-query").UseMutationResult<import("./upgrade").ManagedUpgradeOperation, Error, string, unknown>;
export declare function useManagedGitHub(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    avatar_url?: string | null;
    configured: boolean;
    connected: boolean;
    expires_at_ms?: number | null;
    git_configured: boolean;
    git_email?: string | null;
    git_name?: string | null;
    login?: string | null;
    name?: string | null;
    organization?: string | null;
}>, Error>;
export declare function useManagedSecrets(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    healthy: boolean;
    secrets: import("../../types/openapi.generated").components["schemas"]["ManagedSecretSummary"][];
}>, Error>;
export declare function usePutManagedSecret(): import("@tanstack/react-query").UseMutationResult<{
    name: string;
    updated_at_unix_ms: number;
}, Error, {
    name: string;
    value: string;
}, unknown>;
export declare function useDeleteManagedSecret(): import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
export declare function useManagedAuth(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    providers: import("../../types/openapi.generated").components["schemas"]["ManagedAuthStatusResponse"][];
}>, Error>;
export declare function useManagedProviderModels(backend: BackendKind | null, enabled: boolean, baseUrl?: string | null): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    base_url: string;
    models: import("../../types/openapi.generated").components["schemas"]["ProviderModel"][];
}>, Error>;
export declare function useReadyProviderModels(catalog: ModelCatalog | undefined): Map<"deepseek-chat" | "fireworks-chat" | "together-chat" | "openai-responses" | "openai-chat-completions" | "chatgpt-codex-responses" | "anthropic-messages" | "arcee-auth" | "arcee-api", {
    display_name: string | null;
    id: string;
}[] | null>;
