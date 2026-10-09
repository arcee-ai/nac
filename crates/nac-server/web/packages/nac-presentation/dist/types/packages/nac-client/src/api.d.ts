import { ApiError, type NacClient } from "./nacClient.js";
import type { UpdateGitIdentityRequest, AuthenticateMcpOAuthRequest, ConfigureMcpOAuthRequest, AssignSessionRequest, CommitWorkspaceRequest, CreateModelConfigurationRequest, CreateGoalRequest, CreateProjectRequest, CreateSessionRequest, DeleteProjectSessions, LaunchModelDefaultsRequest, InboxDelivery, ManagedAuthProvider, StartManagedCloneRequest, CreateMcpServerRequest, UpdateMcpServerRequest, TestMcpServerRequest, PermissionApprovalMode, PermissionReply, StartTraditionalChildRequest, StartManagedOrchestratorRequest, ProviderModelsRequest, ReorderProjectsRequest, ReorderSessionsRequest, SessionEventBoundary, CreateSshConfigurationRequest, UpdateSshConfigurationRequest, SshTarget, SwitchBranchRequest, UpdateConfigRequest, UpdateGoalRequest, UpdateModelConfigurationRequest, UpdateProjectRequest, UpdateSessionPresentationRequest, WorkspaceDiffStage } from "./types.js";
export { ApiError };
export interface WorkspaceDiffOptions {
    stage?: WorkspaceDiffStage | "all";
    context?: number;
    /** Diff a captured revision instead of the working tree. */
    revision?: number | null;
    signal?: AbortSignal;
}
export interface ListSessionsOptions {
    workspaceStats?: boolean;
    /** Narrows the listing to one project; unassigned sessions are excluded. */
    projectId?: string | null;
}
interface SessionSnapshotOptions {
    messageLimit?: number;
    threadEventLimit?: number;
    includeSessions?: boolean;
    includeSystem?: boolean;
    signal?: AbortSignal;
}
export interface MessagesPageOptions {
    before?: number;
    limit?: number;
    includeSystem?: boolean;
    signal?: AbortSignal;
}
export interface ThreadEventsOptions {
    beforeId?: number;
    limit?: number;
    signal?: AbortSignal;
}
export declare function createNacApi(nacClient: NacClient): {
    health: (signal?: AbortSignal) => Promise<{
        status: string;
    }>;
    getStore: (signal?: AbortSignal) => Promise<{
        root_cwd: string;
        store_path: string;
        worker_executable: string;
    }>;
    getManagedStatus: (signal?: AbortSignal) => Promise<{
        build_id: string;
        build_track: string;
        checks: import("./openapi.generated.js").components["schemas"]["ReadinessCheck"][];
        github_status: string;
        logical_host_id: string;
        maintenance?: null | import("./openapi.generated.js").components["schemas"]["ManagedMaintenanceSnapshot"];
        maintenance_state: string;
        managed: boolean;
        migration_failure?: string | null;
        migration_state: string;
        minimum_migratable_schema_version: number;
        model: import("./openapi.generated.js").components["schemas"]["ManagedModelStatus"];
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
    }>;
    getManagedGitIdentity: (signal?: AbortSignal) => Promise<{
        email: string;
        name: string;
    }>;
    updateManagedGitIdentity: (payload: UpdateGitIdentityRequest) => Promise<{
        email: string;
        name: string;
    }>;
    getManagedGitHub: (signal?: AbortSignal) => Promise<{
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
    }>;
    startManagedGitHubLogin: () => Promise<{
        expires_in_secs: number;
        login_id: string;
        user_code: string;
        verification_uri: string;
    }>;
    pollManagedGitHubLogin: (loginId: string, signal?: AbortSignal) => Promise<{
        state: "pending";
    } | {
        auth: import("./openapi.generated.js").components["schemas"]["GitHubStatusResponse"];
        state: "complete";
    } | {
        error: string;
        state: "failed";
    }>;
    cancelManagedGitHubLogin: (loginId: string) => Promise<void>;
    disconnectManagedGitHub: () => Promise<{
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
    }>;
    listManagedGitHubRepositories: (signal?: AbortSignal) => Promise<{
        repositories: import("./openapi.generated.js").components["schemas"]["GitHubRepositoryResponse"][];
    }>;
    listManagedGitHubBranches: (owner: string, repository: string, signal?: AbortSignal) => Promise<{
        branches: string[];
    }>;
    startManagedClone: (payload: StartManagedCloneRequest) => Promise<{
        branch: string;
        created_at_unix_ms: number;
        destination: string;
        error?: string | null;
        operation_id: string;
        progress: string;
        project?: null | import("./openapi.generated.js").components["schemas"]["ProjectRecord"];
        project_id: string;
        project_name: string;
        repository: string;
        repository_id: number;
        reused_existing_checkout: boolean;
        source_identity: string;
        status: import("./openapi.generated.js").components["schemas"]["ManagedCloneStatus"];
        updated_at_unix_ms: number;
        version: number;
    }>;
    getManagedClone: (operationId: string, signal?: AbortSignal) => Promise<{
        branch: string;
        created_at_unix_ms: number;
        destination: string;
        error?: string | null;
        operation_id: string;
        progress: string;
        project?: null | import("./openapi.generated.js").components["schemas"]["ProjectRecord"];
        project_id: string;
        project_name: string;
        repository: string;
        repository_id: number;
        reused_existing_checkout: boolean;
        source_identity: string;
        status: import("./openapi.generated.js").components["schemas"]["ManagedCloneStatus"];
        updated_at_unix_ms: number;
        version: number;
    }>;
    cancelManagedClone: (operationId: string) => Promise<{
        branch: string;
        created_at_unix_ms: number;
        destination: string;
        error?: string | null;
        operation_id: string;
        progress: string;
        project?: null | import("./openapi.generated.js").components["schemas"]["ProjectRecord"];
        project_id: string;
        project_name: string;
        repository: string;
        repository_id: number;
        reused_existing_checkout: boolean;
        source_identity: string;
        status: import("./openapi.generated.js").components["schemas"]["ManagedCloneStatus"];
        updated_at_unix_ms: number;
        version: number;
    }>;
    terminateTerminal: (sessionId: string, terminalId: string) => Promise<void>;
    listManagedSecrets: (signal?: AbortSignal) => Promise<{
        healthy: boolean;
        secrets: import("./openapi.generated.js").components["schemas"]["ManagedSecretSummary"][];
    }>;
    putManagedSecret: (name: string, value: string) => Promise<{
        name: string;
        updated_at_unix_ms: number;
    }>;
    deleteManagedSecret: (name: string) => Promise<void>;
    getSandboxAvailability: (signal?: AbortSignal) => Promise<{
        detail?: string | null;
        guidance?: string | null;
        status: import("./openapi.generated.js").components["schemas"]["SandboxAvailabilityStatus"];
    }>;
    getSandboxActivity: (key: string, signal?: AbortSignal) => Promise<{
        phase: string;
        since_epoch_ms: number;
    } | null>;
    listCredentials: (signal?: AbortSignal) => Promise<{
        credentials: import("./openapi.generated.js").components["schemas"]["StoredCredentialSummary"][];
    }>;
    storeCredential: (name: string, value: string) => Promise<void>;
    /** Files a key under a server-generated name and reports what it was. */
    storeGeneratedCredential: (value: string) => Promise<{
        name: string;
    }>;
    deleteCredential: (name: string) => Promise<void>;
    listManagedAuth: (signal?: AbortSignal) => Promise<{
        providers: import("./openapi.generated.js").components["schemas"]["ManagedAuthStatusResponse"][];
    }>;
    startManagedLogin: (provider: ManagedAuthProvider) => Promise<{
        expires_in_secs: number;
        login_id: string;
        provider: import("./openapi.generated.js").components["schemas"]["ManagedAuthProvider"];
        user_code: string | null;
        verification_uri: string;
    }>;
    pollManagedLogin: (provider: ManagedAuthProvider, loginId: string, signal?: AbortSignal) => Promise<{
        state: "pending";
    } | {
        auth: import("./openapi.generated.js").components["schemas"]["ManagedAuthStatusResponse"];
        state: "complete";
    } | {
        error: string;
        state: "failed";
    }>;
    cancelManagedLogin: (provider: ManagedAuthProvider, loginId: string) => Promise<void>;
    managedLogout: (provider: ManagedAuthProvider) => Promise<{
        account: string | null;
        backend: import("./openapi.generated.js").components["schemas"]["BackendKind"];
        base_url: string | null;
        expires_at_ms: number | null;
        organization: string | null;
        path: string;
        provider: import("./openapi.generated.js").components["schemas"]["ManagedAuthProvider"];
        signed_in: boolean;
    }>;
    browsePath: (path: string | null, kind?: "directory" | "toml" | "file", hidden?: boolean, signal?: AbortSignal) => Promise<{
        entries: import("./openapi.generated.js").components["schemas"]["BrowseEntry"][];
        home?: string | null;
        parent?: string | null;
        path: string;
        truncated: boolean;
    }>;
    /**
     * The same listing for a directory on an SSH host. Also the connection test
     * the launch form runs first: only a working connection can answer.
     */
    browseSshPath: (target: SshTarget, path: string | null, hidden?: boolean, signal?: AbortSignal) => Promise<{
        entries: import("./openapi.generated.js").components["schemas"]["BrowseEntry"][];
        home?: string | null;
        parent?: string | null;
        path: string;
        truncated: boolean;
    }>;
    /** Validates the key as a side effect: a bad key cannot list models. */
    listProviderModels: (payload: ProviderModelsRequest, signal?: AbortSignal) => Promise<{
        base_url: string;
        models: import("./openapi.generated.js").components["schemas"]["ProviderModel"][];
    }>;
    /**
     * The server's own catalog: limits, prices and effort support for the models
     * it knows about. Local and credential-free, so it answers for every provider
     * at once — unlike `listProviderModels`, which asks one provider.
     */
    getModelCatalog: (signal?: AbortSignal) => Promise<{
        catalog_version: number;
        providers: import("./openapi.generated.js").components["schemas"]["ProviderListing"][];
    }>;
    listCommands: (signal?: AbortSignal) => Promise<{
        accepts_arguments: boolean;
        arguments?: import("./openapi.generated.js").components["schemas"]["McpPromptArgument"][];
        command: import("./openapi.generated.js").components["schemas"]["SlashCommand"];
        description: string;
        name: string;
    }[]>;
    listSessionCommands: (sessionId: string, signal?: AbortSignal) => Promise<{
        accepts_arguments: boolean;
        arguments?: import("./openapi.generated.js").components["schemas"]["McpPromptArgument"][];
        command: import("./openapi.generated.js").components["schemas"]["SlashCommand"];
        description: string;
        name: string;
    }[]>;
    listSessionSkills: (sessionId: string, signal?: AbortSignal) => Promise<{
        compatibility?: string | null;
        description: string;
        name: string;
    }[]>;
    listModelConfigs: (signal?: AbortSignal) => Promise<{
        configurations: import("./openapi.generated.js").components["schemas"]["ModelConfigurationRecord"][];
    }>;
    createModelConfig: (payload: CreateModelConfigurationRequest) => Promise<{
        allow_insecure_http: boolean;
        api_key_env?: string | null;
        backend: string;
        base_url: string;
        config_id: string;
        created_at: string;
        extra_headers: Record<string, string>;
        initial_prompt?: string | null;
        light_model?: null | import("./openapi.generated.js").components["schemas"]["LightModelSettings"];
        model: string;
        name: string;
        orchestrator_compaction_threshold?: number | null;
        reasoning_effort?: string | null;
        updated_at: string;
    }>;
    updateModelConfig: (configId: string, payload: UpdateModelConfigurationRequest) => Promise<{
        allow_insecure_http: boolean;
        api_key_env?: string | null;
        backend: string;
        base_url: string;
        config_id: string;
        created_at: string;
        extra_headers: Record<string, string>;
        initial_prompt?: string | null;
        light_model?: null | import("./openapi.generated.js").components["schemas"]["LightModelSettings"];
        model: string;
        name: string;
        orchestrator_compaction_threshold?: number | null;
        reasoning_effort?: string | null;
        updated_at: string;
    }>;
    deleteModelConfig: (configId: string) => Promise<void>;
    listSshConfigs: (signal?: AbortSignal) => Promise<{
        configurations: import("./openapi.generated.js").components["schemas"]["SshConfigurationRecord"][];
    }>;
    createSshConfig: (payload: CreateSshConfigurationRequest) => Promise<{
        config_id: string;
        created_at: string;
        name: string;
        ssh_host: string;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }>;
    updateSshConfig: (configId: string, payload: UpdateSshConfigurationRequest) => Promise<{
        config_id: string;
        created_at: string;
        name: string;
        ssh_host: string;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }>;
    deleteSshConfig: (configId: string) => Promise<void>;
    getMcpLibrary: (signal?: AbortSignal) => Promise<{
        entries: import("./openapi.generated.js").components["schemas"]["McpLibraryEntry"][];
    }>;
    listMcpServers: (signal?: AbortSignal) => Promise<{
        servers: import("./openapi.generated.js").components["schemas"]["McpServerView"][];
    }>;
    createMcpServer: (payload: CreateMcpServerRequest) => Promise<{
        allowed_tools?: string[] | null;
        approval: import("./openapi.generated.js").components["schemas"]["McpToolApproval"];
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
        header_helper?: null | import("./openapi.generated.js").components["schemas"]["McpHeaderHelperConfig"];
        headers: Record<string, string>;
        library_id?: string | null;
        name: string;
        protocol: import("./openapi.generated.js").components["schemas"]["McpProtocolSelection"];
        required: boolean;
        startup_timeout_ms?: number | null;
        tool_approvals: Record<string, import("./openapi.generated.js").components["schemas"]["McpToolApproval"]>;
        transport: import("./openapi.generated.js").components["schemas"]["McpTransportSchema"];
        url?: string | null;
    }>;
    updateMcpServer: (serverName: string, payload: UpdateMcpServerRequest) => Promise<{
        allowed_tools?: string[] | null;
        approval: import("./openapi.generated.js").components["schemas"]["McpToolApproval"];
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
        header_helper?: null | import("./openapi.generated.js").components["schemas"]["McpHeaderHelperConfig"];
        headers: Record<string, string>;
        library_id?: string | null;
        name: string;
        protocol: import("./openapi.generated.js").components["schemas"]["McpProtocolSelection"];
        required: boolean;
        startup_timeout_ms?: number | null;
        tool_approvals: Record<string, import("./openapi.generated.js").components["schemas"]["McpToolApproval"]>;
        transport: import("./openapi.generated.js").components["schemas"]["McpTransportSchema"];
        url?: string | null;
    }>;
    deleteMcpServer: (serverName: string) => Promise<void>;
    /** Connects and lists tools without saving anything. */
    testMcpServer: (payload: TestMcpServerRequest) => Promise<{
        auth_required: boolean;
        connected: boolean;
        error?: string | null;
        probe?: null | import("./openapi.generated.js").components["schemas"]["McpProbeResult"];
        tools: import("./openapi.generated.js").components["schemas"]["McpProbedTool"][];
    }>;
    getMcpOAuthStatus: (name: string, signal?: AbortSignal) => Promise<{
        authorization_url?: string | null;
        message?: string | null;
        status: import("./openapi.generated.js").components["schemas"]["McpOAuthPublicStatus"];
    }>;
    configureMcpOAuth: (name: string, payload: ConfigureMcpOAuthRequest) => Promise<{
        authorization_url?: string | null;
        message?: string | null;
        status: import("./openapi.generated.js").components["schemas"]["McpOAuthPublicStatus"];
    }>;
    authenticateMcpOAuth: (name: string, payload?: AuthenticateMcpOAuthRequest) => Promise<{
        authorization_url: string;
        status: import("./openapi.generated.js").components["schemas"]["McpOAuthPublicStatus"];
    }>;
    logoutMcpOAuth: (name: string) => Promise<{
        authorization_url?: string | null;
        message?: string | null;
        status: import("./openapi.generated.js").components["schemas"]["McpOAuthPublicStatus"];
    }>;
    listMcpRuntimeStatus: (signal?: AbortSignal) => Promise<{
        servers: import("./openapi.generated.js").components["schemas"]["McpRuntimeStatus"][];
    }>;
    connectMcpServer: (serverName: string) => Promise<{
        auth_required: boolean;
        error?: string | null;
        name: string;
        protocol_version?: string | null;
        required: boolean;
        server_name?: string | null;
        server_version?: string | null;
        state: import("./openapi.generated.js").components["schemas"]["McpRuntimeState"];
        tool_count: number;
    }>;
    disconnectMcpServer: (serverName: string) => Promise<{
        auth_required: boolean;
        error?: string | null;
        name: string;
        protocol_version?: string | null;
        required: boolean;
        server_name?: string | null;
        server_version?: string | null;
        state: import("./openapi.generated.js").components["schemas"]["McpRuntimeState"];
        tool_count: number;
    }>;
    reloadMcpServer: (serverName: string) => Promise<{
        auth_required: boolean;
        error?: string | null;
        name: string;
        protocol_version?: string | null;
        required: boolean;
        server_name?: string | null;
        server_version?: string | null;
        state: import("./openapi.generated.js").components["schemas"]["McpRuntimeState"];
        tool_count: number;
    }>;
    /** Resolves a saved configuration's credential and lists its models. */
    resolveModelConfig: (configId: string, signal?: AbortSignal) => Promise<{
        allow_insecure_http: boolean;
        api_key_env: string | null;
        backend: import("./openapi.generated.js").components["schemas"]["BackendKind"];
        base_url: string;
        model: string | null;
        models: import("./openapi.generated.js").components["schemas"]["ProviderModel"][];
        models_error: string | null;
        reasoning_effort: null | import("./openapi.generated.js").components["schemas"]["ReasoningEffort"];
    }>;
    resolveConfigFile: (path: string, signal?: AbortSignal) => Promise<{
        allow_insecure_http: boolean;
        api_key_env: string | null;
        backend: import("./openapi.generated.js").components["schemas"]["BackendKind"];
        base_url: string;
        model: string | null;
        models: import("./openapi.generated.js").components["schemas"]["ProviderModel"][];
        models_error: string | null;
        reasoning_effort: null | import("./openapi.generated.js").components["schemas"]["ReasoningEffort"];
    }>;
    listProjects: (signal?: AbortSignal) => Promise<{
        projects: import("./openapi.generated.js").components["schemas"]["ProjectRecord"][];
    }>;
    createProject: (payload: CreateProjectRequest) => Promise<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }>;
    updateProject: (projectId: string, payload: UpdateProjectRequest) => Promise<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }>;
    /** Releases the project's sessions unless asked to delete them too. */
    deleteProject: (projectId: string, sessions?: DeleteProjectSessions) => Promise<{
        deleted_session_ids: string[];
        released_session_ids: string[];
    }>;
    assignSessionToProject: (projectId: string, payload: AssignSessionRequest) => Promise<{
        created_at: string;
        cwd: string;
        default_model_config_id?: string | null;
        description?: string | null;
        name: string;
        pinned: boolean;
        presentation_version: number;
        project_id: string;
        sort_order: number;
        ssh_host?: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        updated_at: string;
    }>;
    reorderProjects: (payload: ReorderProjectsRequest) => Promise<{
        pinned: boolean;
        projects: import("./openapi.generated.js").components["schemas"]["ProjectRecord"][];
    }>;
    listSessions: (options?: ListSessionsOptions, signal?: AbortSignal) => Promise<{
        active: boolean;
        active_run?: null | import("./openapi.generated.js").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("./openapi.generated.js").components["schemas"]["SessionLineageSnapshot"];
        summary: import("./openapi.generated.js").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("./openapi.generated.js").components["schemas"]["WorkspaceDiffTotals"];
    }[]>;
    getSession: (id: string, options?: SessionSnapshotOptions) => Promise<{
        active_compaction?: null | import("./openapi.generated.js").components["schemas"]["ActiveCompactionSnapshot"];
        active_run?: null | import("./openapi.generated.js").components["schemas"]["ActiveRunSnapshot"];
        active_threads?: string[];
        covered_orchestrator_steering_ids?: number[];
        forks?: import("./openapi.generated.js").components["schemas"]["SessionForkLink"][];
        message_created_at?: (string | null)[];
        messages: import("./openapi.generated.js").components["schemas"]["Message"][];
        metadata: import("./openapi.generated.js").components["schemas"]["SessionMetadata"];
        primary_tool_events?: import("./openapi.generated.js").components["schemas"]["AgentEvent"][];
        response_timing: import("./openapi.generated.js").components["schemas"]["ResponseTimingSnapshot"];
        run_failure?: null | import("./openapi.generated.js").components["schemas"]["RunFailure"];
        sessions: import("./openapi.generated.js").components["schemas"]["SessionSummarySnapshot"][];
        thread_episodes: Record<string, import("./openapi.generated.js").components["schemas"]["EpisodeSnapshot"][]>;
        thread_event_boundary: import("./openapi.generated.js").components["schemas"]["SessionEventBoundary"];
        thread_event_diagnostics?: import("./openapi.generated.js").components["schemas"]["ThreadEventDecodeDiagnostic"][];
        thread_events?: Record<string, import("./openapi.generated.js").components["schemas"]["AgentEvent"][]>;
        thread_steering?: import("./openapi.generated.js").components["schemas"]["ThreadSteeringRecord"][];
        threads: import("./openapi.generated.js").components["schemas"]["ThreadSnapshot"][];
        transcript_recovery_warning?: string | null;
        worksets: import("./openapi.generated.js").components["schemas"]["WorksetsSnapshot"];
        workspace: import("./openapi.generated.js").components["schemas"]["WorkspaceSnapshot"];
    } & {
        lineage?: null | import("./openapi.generated.js").components["schemas"]["SessionLineageSnapshot"];
        message_cycle?: null | import("./openapi.generated.js").components["schemas"]["MessageCycleMetadata"];
        message_page?: null | import("./openapi.generated.js").components["schemas"]["MessagePageMetadata"];
    }>;
    createSession: (payload: CreateSessionRequest) => Promise<{
        active_compaction?: null | import("./openapi.generated.js").components["schemas"]["ActiveCompactionSnapshot"];
        active_run?: null | import("./openapi.generated.js").components["schemas"]["ActiveRunSnapshot"];
        active_threads?: string[];
        covered_orchestrator_steering_ids?: number[];
        forks?: import("./openapi.generated.js").components["schemas"]["SessionForkLink"][];
        message_created_at?: (string | null)[];
        messages: import("./openapi.generated.js").components["schemas"]["Message"][];
        metadata: import("./openapi.generated.js").components["schemas"]["SessionMetadata"];
        primary_tool_events?: import("./openapi.generated.js").components["schemas"]["AgentEvent"][];
        response_timing: import("./openapi.generated.js").components["schemas"]["ResponseTimingSnapshot"];
        run_failure?: null | import("./openapi.generated.js").components["schemas"]["RunFailure"];
        sessions: import("./openapi.generated.js").components["schemas"]["SessionSummarySnapshot"][];
        thread_episodes: Record<string, import("./openapi.generated.js").components["schemas"]["EpisodeSnapshot"][]>;
        thread_event_boundary: import("./openapi.generated.js").components["schemas"]["SessionEventBoundary"];
        thread_event_diagnostics?: import("./openapi.generated.js").components["schemas"]["ThreadEventDecodeDiagnostic"][];
        thread_events?: Record<string, import("./openapi.generated.js").components["schemas"]["AgentEvent"][]>;
        thread_steering?: import("./openapi.generated.js").components["schemas"]["ThreadSteeringRecord"][];
        threads: import("./openapi.generated.js").components["schemas"]["ThreadSnapshot"][];
        transcript_recovery_warning?: string | null;
        worksets: import("./openapi.generated.js").components["schemas"]["WorksetsSnapshot"];
        workspace: import("./openapi.generated.js").components["schemas"]["WorkspaceSnapshot"];
    } & {
        lineage?: null | import("./openapi.generated.js").components["schemas"]["SessionLineageSnapshot"];
        message_cycle?: null | import("./openapi.generated.js").components["schemas"]["MessageCycleMetadata"];
        message_page?: null | import("./openapi.generated.js").components["schemas"]["MessagePageMetadata"];
    }>;
    deleteSession: (id: string) => Promise<void>;
    launchDefaults: (payload: LaunchModelDefaultsRequest, signal?: AbortSignal) => Promise<{
        configured_model?: string | null;
        configured_reasoning_effort?: null | import("./openapi.generated.js").components["schemas"]["ReasoningEffort"];
    }>;
    updatePresentation: (id: string, payload: UpdateSessionPresentationRequest) => Promise<{
        backend: string;
        behavior?: import("./openapi.generated.js").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: null | import("./openapi.generated.js").components["schemas"]["SessionForkOrigin"];
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }>;
    reorderSessions: (payload: ReorderSessionsRequest) => Promise<{
        pinned: boolean;
        sessions: import("./openapi.generated.js").components["schemas"]["SessionSummarySnapshot"][];
    }>;
    getConfig: (id: string, signal?: AbortSignal) => Promise<{
        allow_insecure_http: boolean;
        api_key_env: string | null;
        backend: string | null;
        base_url: string;
        config_version: number;
        diagnostics?: string[];
        extra_headers_json: string | null;
        light_model?: null | import("./openapi.generated.js").components["schemas"]["LightModelSettings"];
        model: string;
        orchestrator_compaction_threshold: number | null;
        reasoning_effort: string | null;
        session_id: string;
    }>;
    getPermissions: (id: string, signal?: AbortSignal) => Promise<{
        approval_mode: import("./openapi.generated.js").components["schemas"]["PermissionApprovalMode"];
        grants: import("./openapi.generated.js").components["schemas"]["PermissionGrantRecord"][];
        requests: import("./openapi.generated.js").components["schemas"]["PermissionRequest"][];
    }>;
    replyPermission: (id: string, requestId: string, reply: PermissionReply) => Promise<void>;
    setPermissionApprovalMode: (id: string, mode: PermissionApprovalMode) => Promise<void>;
    deletePermissionGrant: (id: string, grantId: string) => Promise<void>;
    getGoal: (id: string, signal?: AbortSignal) => Promise<{
        accounting_run_id: string | null;
        accounting_started_at_epoch_ms: number | null;
        accounting_token_baseline: number | null;
        consecutive_transient_failures: number;
        continuation_run_id: string | null;
        created_at: string;
        goal_id: string;
        last_failure: null | import("./openapi.generated.js").components["schemas"]["RunFailure"];
        next_attempt_at_epoch_ms: number | null;
        objective: string;
        session_id: string;
        status: import("./openapi.generated.js").components["schemas"]["GoalStatus"];
        time_used_ms: number;
        token_budget: number | null;
        tokens_used: number;
        updated_at: string;
        version: number;
    } | null>;
    createGoal: (id: string, payload: CreateGoalRequest) => Promise<{
        accounting_run_id: string | null;
        accounting_started_at_epoch_ms: number | null;
        accounting_token_baseline: number | null;
        consecutive_transient_failures: number;
        continuation_run_id: string | null;
        created_at: string;
        goal_id: string;
        last_failure: null | import("./openapi.generated.js").components["schemas"]["RunFailure"];
        next_attempt_at_epoch_ms: number | null;
        objective: string;
        session_id: string;
        status: import("./openapi.generated.js").components["schemas"]["GoalStatus"];
        time_used_ms: number;
        token_budget: number | null;
        tokens_used: number;
        updated_at: string;
        version: number;
    }>;
    updateGoal: (id: string, goalId: string, payload: UpdateGoalRequest) => Promise<{
        accounting_run_id: string | null;
        accounting_started_at_epoch_ms: number | null;
        accounting_token_baseline: number | null;
        consecutive_transient_failures: number;
        continuation_run_id: string | null;
        created_at: string;
        goal_id: string;
        last_failure: null | import("./openapi.generated.js").components["schemas"]["RunFailure"];
        next_attempt_at_epoch_ms: number | null;
        objective: string;
        session_id: string;
        status: import("./openapi.generated.js").components["schemas"]["GoalStatus"];
        time_used_ms: number;
        token_budget: number | null;
        tokens_used: number;
        updated_at: string;
        version: number;
    }>;
    clearGoal: (id: string, goalId: string, expectedVersion: number) => Promise<void>;
    listInbox: (id: string, signal?: AbortSignal) => Promise<{
        cancelled_at?: string | null;
        client_id?: string | null;
        created_at: string;
        delivered_at?: string | null;
        delivered_run_id?: string | null;
        delivery: import("./openapi.generated.js").components["schemas"]["InboxDelivery"];
        id: number;
        prompt: string;
        session_id: string;
        status: import("./openapi.generated.js").components["schemas"]["InboxStatus"];
        target_run_id?: string | null;
        updated_at: string;
        version: number;
    }[]>;
    createInboxItem: (id: string, delivery: InboxDelivery, prompt: string) => Promise<{
        cancelled_at?: string | null;
        client_id?: string | null;
        created_at: string;
        delivered_at?: string | null;
        delivered_run_id?: string | null;
        delivery: import("./openapi.generated.js").components["schemas"]["InboxDelivery"];
        id: number;
        prompt: string;
        session_id: string;
        status: import("./openapi.generated.js").components["schemas"]["InboxStatus"];
        target_run_id?: string | null;
        updated_at: string;
        version: number;
    }>;
    updateInboxItem: (id: string, itemId: number, expectedVersion: number, delivery: InboxDelivery) => Promise<{
        cancelled_at?: string | null;
        client_id?: string | null;
        created_at: string;
        delivered_at?: string | null;
        delivered_run_id?: string | null;
        delivery: import("./openapi.generated.js").components["schemas"]["InboxDelivery"];
        id: number;
        prompt: string;
        session_id: string;
        status: import("./openapi.generated.js").components["schemas"]["InboxStatus"];
        target_run_id?: string | null;
        updated_at: string;
        version: number;
    }>;
    cancelInboxItem: (id: string, itemId: number, expectedVersion: number) => Promise<{
        cancelled_at?: string | null;
        client_id?: string | null;
        created_at: string;
        delivered_at?: string | null;
        delivered_run_id?: string | null;
        delivery: import("./openapi.generated.js").components["schemas"]["InboxDelivery"];
        id: number;
        prompt: string;
        session_id: string;
        status: import("./openapi.generated.js").components["schemas"]["InboxStatus"];
        target_run_id?: string | null;
        updated_at: string;
        version: number;
    }>;
    listTraditionalChildren: (id: string, signal?: AbortSignal) => Promise<{
        change_summary: string | null;
        child_session_id: string;
        completion_inbox_id: number | null;
        created_at: string;
        description: string;
        execution_mode: null | import("./openapi.generated.js").components["schemas"]["TraditionalChildExecutionMode"];
        failure: string | null;
        generation: number;
        nesting_depth: number;
        parent_session_id: string;
        profile: string;
        report: string | null;
        root_session_id: string;
        run_id: string | null;
        status: import("./openapi.generated.js").components["schemas"]["TraditionalChildStatus"];
        updated_at: string;
        verification_summary: string | null;
        version: number;
    }[]>;
    startTraditionalChild: (id: string, payload: StartTraditionalChildRequest) => Promise<{
        change_summary: string | null;
        child_session_id: string;
        completion_inbox_id: number | null;
        created_at: string;
        description: string;
        execution_mode: null | import("./openapi.generated.js").components["schemas"]["TraditionalChildExecutionMode"];
        failure: string | null;
        generation: number;
        nesting_depth: number;
        parent_session_id: string;
        profile: string;
        report: string | null;
        root_session_id: string;
        run_id: string | null;
        status: import("./openapi.generated.js").components["schemas"]["TraditionalChildStatus"];
        updated_at: string;
        verification_summary: string | null;
        version: number;
    }>;
    getTraditionalChild: (id: string, childId: string, signal?: AbortSignal) => Promise<{
        change_summary: string | null;
        child_session_id: string;
        completion_inbox_id: number | null;
        created_at: string;
        description: string;
        execution_mode: null | import("./openapi.generated.js").components["schemas"]["TraditionalChildExecutionMode"];
        failure: string | null;
        generation: number;
        nesting_depth: number;
        parent_session_id: string;
        profile: string;
        report: string | null;
        root_session_id: string;
        run_id: string | null;
        status: import("./openapi.generated.js").components["schemas"]["TraditionalChildStatus"];
        updated_at: string;
        verification_summary: string | null;
        version: number;
    }>;
    cancelTraditionalChild: (id: string, childId: string) => Promise<{
        change_summary: string | null;
        child_session_id: string;
        completion_inbox_id: number | null;
        created_at: string;
        description: string;
        execution_mode: null | import("./openapi.generated.js").components["schemas"]["TraditionalChildExecutionMode"];
        failure: string | null;
        generation: number;
        nesting_depth: number;
        parent_session_id: string;
        profile: string;
        report: string | null;
        root_session_id: string;
        run_id: string | null;
        status: import("./openapi.generated.js").components["schemas"]["TraditionalChildStatus"];
        updated_at: string;
        verification_summary: string | null;
        version: number;
    }>;
    listManagedOrchestrators: (id: string, signal?: AbortSignal) => Promise<{
        completion_inbox_id?: number | null;
        created_at: string;
        description: string;
        execution_mode?: null | import("./openapi.generated.js").components["schemas"]["TraditionalChildExecutionMode"];
        failure?: string | null;
        generation: number;
        orchestrator_session_id: string;
        parent_session_id: string;
        report?: string | null;
        root_session_id: string;
        run_id?: string | null;
        status: import("./openapi.generated.js").components["schemas"]["TraditionalChildStatus"];
        updated_at: string;
        version: number;
    }[]>;
    startManagedOrchestrator: (id: string, payload: StartManagedOrchestratorRequest) => Promise<{
        completion_inbox_id?: number | null;
        created_at: string;
        description: string;
        execution_mode?: null | import("./openapi.generated.js").components["schemas"]["TraditionalChildExecutionMode"];
        failure?: string | null;
        generation: number;
        orchestrator_session_id: string;
        parent_session_id: string;
        report?: string | null;
        root_session_id: string;
        run_id?: string | null;
        status: import("./openapi.generated.js").components["schemas"]["TraditionalChildStatus"];
        updated_at: string;
        version: number;
    }>;
    getManagedOrchestrator: (id: string, orchestratorId: string, signal?: AbortSignal) => Promise<{
        completion_inbox_id?: number | null;
        created_at: string;
        description: string;
        execution_mode?: null | import("./openapi.generated.js").components["schemas"]["TraditionalChildExecutionMode"];
        failure?: string | null;
        generation: number;
        orchestrator_session_id: string;
        parent_session_id: string;
        report?: string | null;
        root_session_id: string;
        run_id?: string | null;
        status: import("./openapi.generated.js").components["schemas"]["TraditionalChildStatus"];
        updated_at: string;
        version: number;
    }>;
    cancelManagedOrchestrator: (id: string, orchestratorId: string) => Promise<{
        completion_inbox_id?: number | null;
        created_at: string;
        description: string;
        execution_mode?: null | import("./openapi.generated.js").components["schemas"]["TraditionalChildExecutionMode"];
        failure?: string | null;
        generation: number;
        orchestrator_session_id: string;
        parent_session_id: string;
        report?: string | null;
        root_session_id: string;
        run_id?: string | null;
        status: import("./openapi.generated.js").components["schemas"]["TraditionalChildStatus"];
        updated_at: string;
        version: number;
    }>;
    updateConfig: (id: string, payload: UpdateConfigRequest) => Promise<void>;
    getMessages: (id: string, options?: MessagesPageOptions) => Promise<{
        created_at: (string | null)[];
        messages: import("./openapi.generated.js").components["schemas"]["Message"][];
        page: import("./openapi.generated.js").components["schemas"]["MessagePageMetadata"];
    }>;
    getThreadEvents: (id: string, threadName: string, options?: ThreadEventsOptions) => Promise<{
        diagnostics?: import("./openapi.generated.js").components["schemas"]["ThreadEventDecodeDiagnostic"][];
        events: import("./openapi.generated.js").components["schemas"]["ThreadEventPageItem"][];
        has_older: boolean;
        next_before_id?: number | null;
        thread_event_boundary?: null | import("./openapi.generated.js").components["schemas"]["SessionEventBoundary"];
    }>;
    getWorkspaceDiff: (id: string, path: string, { stage, context, revision, signal }?: WorkspaceDiffOptions) => Promise<{
        error: string | null;
        old_path: string | null;
        path: string;
        sections: import("./openapi.generated.js").components["schemas"]["WorkspaceDiffSection"][];
    }>;
    getWorkspaceFiles: (id: string, revision: number | null, signal?: AbortSignal) => Promise<{
        files: string[];
        truncated: boolean;
    }>;
    getWorkspaceFile: (id: string, path: string, revision: number | null, signal?: AbortSignal) => Promise<{
        binary: boolean;
        content?: string | null;
        path: string;
        size: number;
        too_large: boolean;
    }>;
    /** Ask nac-web to open a local workspace path with the OS default handler. */
    openWorkspacePath: (id: string, path: string) => Promise<{
        fell_back_to_parent: boolean;
        opened: string;
    }>;
    getWorkspaceRevisions: (id: string, signal?: AbortSignal) => Promise<{
        additions: number;
        base_sha: string | null;
        branch: string | null;
        changed_files: number;
        commit_sha: string;
        created_at: string;
        deletions: number;
        id: number;
        label: string;
        run_id: string;
        session_id: string;
        transcript_len: number | null;
    }[]>;
    getWorkspaceRevisionChanges: (id: string, revision: number, signal?: AbortSignal) => Promise<{
        changed_files: import("./openapi.generated.js").components["schemas"]["ChangedFileStat"][];
        error?: string | null;
        total_additions: number;
        total_deletions: number;
    }>;
    getBranches: (id: string, signal?: AbortSignal) => Promise<{
        branches: import("./openapi.generated.js").components["schemas"]["Branch"][];
        current?: string | null;
        dirty: boolean;
    }>;
    switchBranch: (id: string, body: SwitchBranchRequest) => Promise<{
        branches: import("./openapi.generated.js").components["schemas"]["Branch"][];
        current?: string | null;
        dirty: boolean;
    }>;
    commitWorkspace: (id: string, body: CommitWorkspaceRequest) => Promise<{
        additions: number;
        branch?: string | null;
        deletions: number;
        files_changed: number;
        sha: string;
    }>;
    submitRun: (id: string, prompt: string, signal?: AbortSignal) => Promise<import("./nacClient.js").CommandAdmission<{
        client_id?: string | null;
        display_prompt: string;
        run_id: string;
    }>>;
    cancelActiveRun: (id: string) => Promise<void>;
    cancelExactRun: (id: string, runId: string) => Promise<void>;
    compactSession: (id: string) => Promise<{
        compaction_id: string;
        status: "compacted";
    } | {
        compaction_id: string;
        reason: import("./openapi.generated.js").components["schemas"]["CompactionSkipReason"];
        status: "unchanged";
    }>;
    revertSession: (id: string, messageIdx: number) => Promise<{
        messages_removed: number;
        revisions_removed: number;
        threads_removed: number;
        transcript_len: number;
        workspace_restored: boolean;
    }>;
    regenerateRun: (id: string, messageIdx: number) => Promise<{
        client_id?: string | null;
        display_prompt: string;
        run_id: string;
    }>;
    forkSession: (id: string, messageIdx: number) => Promise<{
        session_id: string;
    }>;
    dismissSessionFork: (id: string, forkId: string) => Promise<void>;
    steerOrchestrator: (id: string, instruction: string) => Promise<{
        instruction_preview: string;
        status: string;
        steering_id: number;
    }>;
    steerThread: (id: string, threadName: string, instruction: string) => Promise<{
        instruction_preview: string;
        status: string;
        steering_id: number;
        thread_name: string;
    }>;
    getRecentEvents: (id: string, options?: {
        cursor?: SessionEventBoundary;
        limit?: number;
        signal?: AbortSignal;
    }) => Promise<{
        boundary: import("./openapi.generated.js").components["schemas"]["SessionEventBoundary"];
        events: import("./openapi.generated.js").components["schemas"]["SessionEventEnvelope"][];
    }>;
};
export type NacApi = ReturnType<typeof createNacApi>;
