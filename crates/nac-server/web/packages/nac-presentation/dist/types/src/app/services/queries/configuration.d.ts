import { type QueryClient } from "@tanstack/react-query";
import { type BrowseKind } from "./keys";
import type { BackendKind, SshTarget, UpdateMcpServerRequest, UpdateModelConfigurationRequest, UpdateSshConfigurationRequest } from "../../types/api";
/**
 * Directory listing from the machine running the server. Only fetched while
 * the picker is open, and never cached long: the filesystem moves under us.
 */
export declare function useBrowsePath(path: string | null, kind: BrowseKind, hidden: boolean, enabled: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    entries: import("../../types/openapi.generated").components["schemas"]["BrowseEntry"][];
    home?: string | null;
    parent?: string | null;
    path: string;
    truncated: boolean;
}>, Error>;
/**
 * The same listing from an SSH host. Only directories come back, so a remote
 * working directory is picked the way a local one is.
 */
export declare function useSshBrowsePath(target: SshTarget | null, path: string | null, hidden: boolean, enabled: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    entries: import("../../types/openapi.generated").components["schemas"]["BrowseEntry"][];
    home?: string | null;
    parent?: string | null;
    path: string;
    truncated: boolean;
}>, Error>;
/**
 * Opens the connection the launch form needs before it can offer anything
 * remote, and reports the login home so the form can start there.
 *
 * A mutation rather than a query because connecting is the user pressing a
 * button, and because the ssh connection it leaves behind is a side effect the
 * session created next reuses.
 */
export declare function useSshConnect(): import("@tanstack/react-query").UseMutationResult<{
    entries: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["BrowseEntry"][];
    home?: string | null;
    parent?: string | null;
    path: string;
    truncated: boolean;
}, Error, SshTarget, unknown>;
export declare function useSshConfigs(): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    configurations: import("../../types/openapi.generated").components["schemas"]["SshConfigurationRecord"][];
}>, Error>;
export declare function useCreateSshConfig(): import("@tanstack/react-query").UseMutationResult<{
    config_id: string;
    created_at: string;
    name: string;
    ssh_host: string;
    ssh_identity_file?: string | null;
    ssh_port?: number | null;
    updated_at: string;
}, Error, {
    name: string;
    ssh_host: string;
    ssh_identity_file?: string | null;
    ssh_port?: number | null;
}, unknown>;
export declare function useUpdateSshConfig(): import("@tanstack/react-query").UseMutationResult<{
    config_id: string;
    created_at: string;
    name: string;
    ssh_host: string;
    ssh_identity_file?: string | null;
    ssh_port?: number | null;
    updated_at: string;
}, Error, {
    configId: string;
    payload: UpdateSshConfigurationRequest;
}, unknown>;
export declare function useDeleteSshConfig(): import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
export declare function useMcpLibrary(): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    entries: import("../../types/openapi.generated").components["schemas"]["McpLibraryEntry"][];
}>, Error>;
export declare function useMcpServers(): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    servers: import("../../types/openapi.generated").components["schemas"]["McpServerView"][];
}>, Error>;
export declare function useCreateMcpServer(): import("@tanstack/react-query").UseMutationResult<{
    allowed_tools?: string[] | null;
    approval: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpToolApproval"];
    args: string[];
    bearer_token_env_var?: string | null;
    catalog_timeout_ms?: number | null;
    command?: string | null;
    cwd?: string | null;
    denied_tools: string[];
    enabled: boolean;
    env: Record<string, string>;
    env_headers: Record<string, string>;
    env_vars: string[];
    execution_timeout_ms?: number | null;
    header_helper?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpHeaderHelperConfig"];
    headers: Record<string, string>;
    library_id?: string | null;
    name: string;
    protocol: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpProtocolSelection"];
    required: boolean;
    startup_timeout_ms?: number | null;
    tool_approvals: Record<string, import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpToolApproval"]>;
    transport: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpTransportSchema"];
    url?: string | null;
}, Error, {
    allowed_tools?: string[] | null;
    approval?: import("../../types/openapi.generated").components["schemas"]["McpToolApproval"];
    args?: string[];
    bearer_token_env_var?: string | null;
    catalog_timeout_ms?: number | null;
    command?: string | null;
    cwd?: string | null;
    denied_tools?: string[];
    enabled?: boolean;
    env?: Record<string, string>;
    env_headers?: Record<string, string>;
    env_vars?: string[];
    execution_timeout_ms?: number | null;
    header_helper?: null | import("../../types/openapi.generated").components["schemas"]["McpHeaderHelperConfig"];
    headers?: Record<string, string>;
    library_id?: string | null;
    name: string;
    protocol?: import("../../types/openapi.generated").components["schemas"]["McpProtocolSelection"];
    required?: boolean;
    startup_timeout_ms?: number | null;
    tool_approvals?: Record<string, import("../../types/openapi.generated").components["schemas"]["McpToolApproval"]>;
    transport: import("../../types/openapi.generated").components["schemas"]["McpTransportSchema"];
    url?: string | null;
}, unknown>;
export declare function useUpdateMcpServer(): import("@tanstack/react-query").UseMutationResult<{
    allowed_tools?: string[] | null;
    approval: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpToolApproval"];
    args: string[];
    bearer_token_env_var?: string | null;
    catalog_timeout_ms?: number | null;
    command?: string | null;
    cwd?: string | null;
    denied_tools: string[];
    enabled: boolean;
    env: Record<string, string>;
    env_headers: Record<string, string>;
    env_vars: string[];
    execution_timeout_ms?: number | null;
    header_helper?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpHeaderHelperConfig"];
    headers: Record<string, string>;
    library_id?: string | null;
    name: string;
    protocol: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpProtocolSelection"];
    required: boolean;
    startup_timeout_ms?: number | null;
    tool_approvals: Record<string, import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpToolApproval"]>;
    transport: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpTransportSchema"];
    url?: string | null;
}, Error, {
    serverName: string;
    payload: UpdateMcpServerRequest;
}, unknown>;
export declare function useDeleteMcpServer(): import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
export declare function useTestMcpServer(): import("@tanstack/react-query").UseMutationResult<{
    auth_required: boolean;
    connected: boolean;
    error?: string | null;
    probe?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpProbeResult"];
    tools: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpProbedTool"][];
}, Error, {
    args?: string[] | null;
    bearer_token_env_var?: string | null;
    catalog_timeout_ms?: number | null;
    command?: string | null;
    cwd?: string | null;
    env?: Record<string, string | null> | null;
    env_headers?: Record<string, string> | null;
    env_vars?: string[] | null;
    execution_timeout_ms?: number | null;
    header_helper?: null | import("../../types/openapi.generated").components["schemas"]["UpdateMcpHeaderHelperRequest"];
    headers?: Record<string, string | null> | null;
    name?: string | null;
    protocol?: null | import("../../types/openapi.generated").components["schemas"]["McpProtocolSelection"];
    startup_timeout_ms?: number | null;
    stored_name?: string | null;
    transport?: string | null;
    url?: string | null;
}, unknown>;
export declare function useMcpRuntimeStatus(): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    servers: import("../../types/openapi.generated").components["schemas"]["McpRuntimeStatus"][];
}>, Error>;
export declare function useMcpRuntimeAction(): import("@tanstack/react-query").UseMutationResult<{
    auth_required: boolean;
    error?: string | null;
    name: string;
    protocol_version?: string | null;
    required: boolean;
    server_name?: string | null;
    server_version?: string | null;
    state: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["McpRuntimeState"];
    tool_count: number;
}, Error, {
    serverName: string;
    action: "connect" | "disconnect" | "reload";
}, unknown>;
export declare function useModelConfigs(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    configurations: import("../../types/openapi.generated").components["schemas"]["ModelConfigurationRecord"][];
}>, Error>;
export declare function useProviderModels(backend: BackendKind, apiKey: string, baseUrl: string | null, enabled: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    base_url: string;
    models: import("../../types/openapi.generated").components["schemas"]["ProviderModel"][];
}>, Error>;
/**
 * The same check as `useProviderModels` for a key that is already on file: the
 * server resolves the name and asks the provider, so an editor that never held
 * the secret can still tell whether it still works and what it can reach.
 */
export declare function useStoredKeyProviderModels(backend: BackendKind, apiKeyEnv: string, baseUrl: string | null, enabled: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    base_url: string;
    models: import("../../types/openapi.generated").components["schemas"]["ProviderModel"][];
}>, Error>;
/**
 * The models a browser login can reach. There is no key to pass, so the stored
 * credential answers, and a rejection here means the login has gone stale.
 *
 * Invalidated when a login completes, which is what turns the model picker from
 * empty into populated without a reload.
 */
/**
 * The server's model catalog: context windows, prices and the efforts each
 * model accepts. It only changes when the server reloads it, and a failure is
 * never fatal — every consumer falls back to showing the raw numbers.
 */
export declare function useModelCatalog(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    catalog_version: number;
    providers: import("../../types/openapi.generated").components["schemas"]["ProviderListing"][];
}>, Error>;
/** Reconcile every cached projection derived from provider-account state. */
export declare function refreshUnifiedProviderCatalog(client: QueryClient): Promise<void>;
/** Reconcile every browser projection after a login is added or removed. */
export declare function refreshProviderAuthentication(client: QueryClient): Promise<void>;
/** Session-scoped slash commands, including prompts discovered from mounted MCP servers. */
export declare function useSlashCommands(sessionId: string): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    accepts_arguments: boolean;
    arguments?: import("../../types/openapi.generated").components["schemas"]["McpPromptArgument"][];
    command: import("../../types/openapi.generated").components["schemas"]["SlashCommand"];
    description: string;
    name: string;
}[]>, Error>;
/** Skills discovered by the service currently attached to this session. */
export declare function useSessionSkills(sessionId: string): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    compatibility?: string | null;
    description: string;
    name: string;
}[]>, Error>;
/**
 * A saved configuration or a `config.toml`, checked end to end by the server:
 * the credential resolves and the provider answers with its model list.
 */
export declare function useResolvedModelConfig(configId: string | null, filePath: string): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    allow_insecure_http: boolean;
    api_key_env: string | null;
    backend: import("../../types/openapi.generated").components["schemas"]["BackendKind"];
    base_url: string;
    model: string | null;
    models: import("../../types/openapi.generated").components["schemas"]["ProviderModel"][];
    models_error: string | null;
    reasoning_effort: null | import("../../types/openapi.generated").components["schemas"]["ReasoningEffort"];
}>, Error>;
export declare function useCreateModelConfig(): import("@tanstack/react-query").UseMutationResult<{
    allow_insecure_http: boolean;
    api_key_env?: string | null;
    backend: string;
    base_url: string;
    config_id: string;
    created_at: string;
    extra_headers: Record<string, string>;
    initial_prompt?: string | null;
    light_model?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["LightModelSettings"];
    model: string;
    name: string;
    orchestrator_compaction_threshold?: number | null;
    reasoning_effort?: string | null;
    updated_at: string;
}, Error, {
    allow_insecure_http?: boolean;
    api_key?: string | null;
    backend: import("../../types/openapi.generated").components["schemas"]["BackendKind"];
    base_url?: string | null;
    extra_headers?: Record<string, string> | null;
    initial_prompt?: string | null;
    light_model?: null | import("../../types/openapi.generated").components["schemas"]["LightModelSettings"];
    model: string;
    name: string;
    orchestrator_compaction_threshold?: number | null;
    reasoning_effort?: null | import("../../types/openapi.generated").components["schemas"]["ReasoningEffort"];
}, unknown>;
export declare function useUpdateModelConfig(): import("@tanstack/react-query").UseMutationResult<{
    allow_insecure_http: boolean;
    api_key_env?: string | null;
    backend: string;
    base_url: string;
    config_id: string;
    created_at: string;
    extra_headers: Record<string, string>;
    initial_prompt?: string | null;
    light_model?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["LightModelSettings"];
    model: string;
    name: string;
    orchestrator_compaction_threshold?: number | null;
    reasoning_effort?: string | null;
    updated_at: string;
}, Error, {
    configId: string;
    payload: UpdateModelConfigurationRequest;
}, unknown>;
export declare function useDeleteModelConfig(): import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
