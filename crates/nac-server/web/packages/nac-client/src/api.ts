import { ApiError, type NacClient } from "./nacClient.js";
import type {
  HealthResponse,
  GitIdentityResponse,
  UpdateGitIdentityRequest,
  McpOAuthStatusResponse,
  AuthenticateMcpOAuthRequest,
  AuthenticateMcpOAuthResponse,
  ConfigureMcpOAuthRequest,
  AssignSessionRequest,
  BranchList,
  BrowseListing,
  CommitOutcome,
  CommitWorkspaceRequest,
  CompactSessionResponse,
  CreateModelConfigurationRequest,
  CreateGoalRequest,
  CreateProjectRequest,
  CreateSessionRequest,
  DeleteProjectResponse,
  DeleteProjectSessions,
  DeviceLoginStarted,
  DeviceLoginState,
  LaunchModelDefaults,
  LaunchModelDefaultsRequest,
  InboxDelivery,
  InboxItem,
  ManagedAuthList,
  ManagedAuthProvider,
  ManagedAuthStatus,
  ManagedCloneOperation,
  ManagedGitHubBranchList,
  ManagedGitHubLoginStarted,
  ManagedGitHubLoginState,
  ManagedGitHubRepositoryList,
  ManagedGitHubStatus,
  ManagedHostStatus,
  ManagedSecretList,
  ManagedSecretSummary,
  StartManagedCloneRequest,
  GeneratedCredential,
  ManagedSessionSummary,
  ManagedOrchestratorRecord,
  McpLibraryResponse,
  McpServerList,
  McpServerView,
  McpRuntimeStatus,
  McpRuntimeStatusList,
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
  TestMcpServerRequest,
  TestMcpServerResponse,
  MessagesPageResponse,
  ModelCatalog,
  ModelConfigurationList,
  ModelConfigurationRecord,
  OrchestratorSteeringResponse,
  PermissionApprovalMode,
  PermissionReply,
  PermissionStateResponse,
  SessionGoalRecord,
  StartTraditionalChildRequest,
  StartManagedOrchestratorRequest,
  TraditionalChildRecord,
  ProjectList,
  ProjectRecord,
  ProviderModelList,
  ProviderModelsRequest,
  RawSessionConfig,
  ReorderProjectsRequest,
  ReorderProjectsResponse,
  ReorderSessionsRequest,
  ReorderSessionsResponse,
  ResolvedModelConfiguration,
  RevertSessionResponse,
  ForkSessionResponse,
  SessionSnapshotResponse,
  SessionEventBoundary,
  SessionSummarySnapshot,
  SkillCatalogEntry,
  SlashCommandDefinition,
  SshBrowseRequest,
  SshConfigurationList,
  SshConfigurationRecord,
  CreateSshConfigurationRequest,
  UpdateSshConfigurationRequest,
  SshTarget,
  StoredCredentialList,
  StoreInfo,
  SandboxActivity,
  SandboxAvailability,
  SubmitPromptResponse,
  SwitchBranchRequest,
  ThreadEventPage,
  ThreadSteeringResponse,
  UpdateConfigRequest,
  UpdateGoalRequest,
  UpdateModelConfigurationRequest,
  UpdateProjectRequest,
  UpdateSessionPresentationRequest,
  WorkspaceDiffStage,
  WorkspaceFileContent,
  WorkspaceFileDiff,
  WorkspaceFileList,
  OpenWorkspacePathResult,
  WorkspaceRevision,
  WorkspaceRevisionChanges,
} from "./types.js";

export { ApiError };

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const sessionPath = (id: string) => `/sessions/${encodeURIComponent(id)}`;

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

export function createNacApi(nacClient: NacClient) {
  async function request<T>(
    method: Method,
    path: string,
    { body, headers, signal }: RequestOptions = {},
  ): Promise<T> {
    return nacClient.transport.request<T>(method, path, { body, headers, signal });
  }

  return {
    health: (signal?: AbortSignal) => request<HealthResponse>("GET", "/health", { signal }),

    getStore: (signal?: AbortSignal) => request<StoreInfo>("GET", "/store", { signal }),

    getManagedStatus: (signal?: AbortSignal) =>
      request<ManagedHostStatus>("GET", "/managed/status", { signal }),

    getManagedGitIdentity: (signal?: AbortSignal) =>
      request<GitIdentityResponse>("GET", "/managed/github/git-identity", { signal }),
    updateManagedGitIdentity: (payload: UpdateGitIdentityRequest) =>
      request<GitIdentityResponse>("PUT", "/managed/github/git-identity", { body: payload }),

    getManagedGitHub: (signal?: AbortSignal) =>
      request<ManagedGitHubStatus>("GET", "/managed/github", { signal }),

    startManagedGitHubLogin: () =>
      request<ManagedGitHubLoginStarted>("POST", "/managed/github/login"),

    pollManagedGitHubLogin: (loginId: string, signal?: AbortSignal) =>
      request<ManagedGitHubLoginState>(
        "GET",
        `/managed/github/login/${encodeURIComponent(loginId)}`,
        { signal },
      ),

    cancelManagedGitHubLogin: (loginId: string) =>
      request<void>("DELETE", `/managed/github/login/${encodeURIComponent(loginId)}`),

    disconnectManagedGitHub: () => request<ManagedGitHubStatus>("DELETE", "/managed/github"),

    listManagedGitHubRepositories: (signal?: AbortSignal) =>
      request<ManagedGitHubRepositoryList>("GET", "/managed/github/repositories", { signal }),

    listManagedGitHubBranches: (owner: string, repository: string, signal?: AbortSignal) =>
      request<ManagedGitHubBranchList>(
        "GET",
        `/managed/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches`,
        { signal },
      ),

    startManagedClone: (payload: StartManagedCloneRequest) =>
      request<ManagedCloneOperation>("POST", "/managed/github/clone-operations", {
        body: payload,
      }),

    getManagedClone: (operationId: string, signal?: AbortSignal) =>
      request<ManagedCloneOperation>(
        "GET",
        `/managed/github/clone-operations/${encodeURIComponent(operationId)}`,
        { signal },
      ),

    cancelManagedClone: (operationId: string) =>
      request<ManagedCloneOperation>(
        "DELETE",
        `/managed/github/clone-operations/${encodeURIComponent(operationId)}`,
      ),

    terminateTerminal: (sessionId: string, terminalId: string) =>
      request<void>(
        "DELETE",
        `${sessionPath(sessionId)}/terminals/${encodeURIComponent(terminalId)}`,
      ),

    listManagedSecrets: (signal?: AbortSignal) =>
      request<ManagedSecretList>("GET", "/managed/secrets", { signal }),

    putManagedSecret: (name: string, value: string) =>
      request<ManagedSecretSummary>("PUT", `/managed/secrets/${encodeURIComponent(name)}`, {
        body: { value },
      }),

    deleteManagedSecret: (name: string) =>
      request<void>("DELETE", `/managed/secrets/${encodeURIComponent(name)}`),

    // Probing spawns podman subprocesses, so callers query this on demand (the
    // launch form's sandbox mode) rather than on page load.
    getSandboxAvailability: (signal?: AbortSignal) =>
      request<SandboxAvailability>("GET", "/sandbox/availability", { signal }),

    // Sandbox setup in progress for one launch, or null when idle. The key is
    // the launch id sent with the create request, so concurrent launches never
    // show each other's phase.
    getSandboxActivity: (key: string, signal?: AbortSignal) =>
      request<SandboxActivity | null>("GET", `/sandbox/activity?${new URLSearchParams({ key })}`, {
        signal,
      }),

    // Credentials are write-only: the value is sent to the server and never
    // read back, so the UI only ever learns which names have a key stored.
    listCredentials: (signal?: AbortSignal) =>
      request<StoredCredentialList>("GET", "/credentials", { signal }),

    storeCredential: (name: string, value: string) =>
      request<void>("PUT", `/credentials/${encodeURIComponent(name)}`, {
        body: { value },
      }),

    /** Files a key under a server-generated name and reports what it was. */
    storeGeneratedCredential: (value: string) =>
      request<GeneratedCredential>("POST", "/credentials", { body: { value } }),

    deleteCredential: (name: string) =>
      request<void>("DELETE", `/credentials/${encodeURIComponent(name)}`),

    // Managed providers sign in with a device login: the server hands back a
    // code to show, waits for the browser approval on its own, and the outcome
    // is collected by polling.
    listManagedAuth: (signal?: AbortSignal) => request<ManagedAuthList>("GET", "/auth", { signal }),

    startManagedLogin: (provider: ManagedAuthProvider) =>
      request<DeviceLoginStarted>("POST", `/auth/${encodeURIComponent(provider)}/login`),

    pollManagedLogin: (provider: ManagedAuthProvider, loginId: string, signal?: AbortSignal) =>
      request<DeviceLoginState>(
        "GET",
        `/auth/${encodeURIComponent(provider)}/login/${encodeURIComponent(loginId)}`,
        { signal },
      ),

    cancelManagedLogin: (provider: ManagedAuthProvider, loginId: string) =>
      request<void>(
        "DELETE",
        `/auth/${encodeURIComponent(provider)}/login/${encodeURIComponent(loginId)}`,
      ),

    managedLogout: (provider: ManagedAuthProvider) =>
      request<ManagedAuthStatus>("DELETE", `/auth/${encodeURIComponent(provider)}`),

    // Browsers withhold absolute paths from every file-picking API, so a local
    // path is chosen against the filesystem the server sees.
    browsePath: (
      path: string | null,
      kind: "directory" | "toml" | "file" = "directory",
      hidden = false,
      signal?: AbortSignal,
    ) => {
      const query = new URLSearchParams({ kind });
      if (path) query.set("path", path);
      if (hidden) query.set("hidden", "true");
      return request<BrowseListing>("GET", `/fs/browse?${query.toString()}`, { signal });
    },

    /**
     * The same listing for a directory on an SSH host. Also the connection test
     * the launch form runs first: only a working connection can answer.
     */
    browseSshPath: (target: SshTarget, path: string | null, hidden = false, signal?: AbortSignal) =>
      request<BrowseListing>("POST", "/ssh/browse", {
        body: { ...target, path, hidden } satisfies SshBrowseRequest,
        signal,
      }),

    /** Validates the key as a side effect: a bad key cannot list models. */
    listProviderModels: (payload: ProviderModelsRequest, signal?: AbortSignal) =>
      request<ProviderModelList>("POST", "/providers/models", { body: payload, signal }),

    /**
     * The server's own catalog: limits, prices and effort support for the models
     * it knows about. Local and credential-free, so it answers for every provider
     * at once — unlike `listProviderModels`, which asks one provider.
     */
    getModelCatalog: (signal?: AbortSignal) => request<ModelCatalog>("GET", "/models", { signal }),

    listCommands: (signal?: AbortSignal) =>
      request<SlashCommandDefinition[]>("GET", "/commands", { signal }),

    listSessionCommands: (sessionId: string, signal?: AbortSignal) =>
      request<SlashCommandDefinition[]>(
        "GET",
        `/sessions/${encodeURIComponent(sessionId)}/commands`,
        { signal },
      ),

    listSessionSkills: (sessionId: string, signal?: AbortSignal) =>
      request<SkillCatalogEntry[]>("GET", `/sessions/${encodeURIComponent(sessionId)}/skills`, {
        signal,
      }),

    listModelConfigs: (signal?: AbortSignal) =>
      request<ModelConfigurationList>("GET", "/model-configs", { signal }),

    createModelConfig: (payload: CreateModelConfigurationRequest) =>
      request<ModelConfigurationRecord>("POST", "/model-configs", { body: payload }),

    updateModelConfig: (configId: string, payload: UpdateModelConfigurationRequest) =>
      request<ModelConfigurationRecord>("PATCH", `/model-configs/${encodeURIComponent(configId)}`, {
        body: payload,
      }),

    deleteModelConfig: (configId: string) =>
      request<void>("DELETE", `/model-configs/${encodeURIComponent(configId)}`),

    listSshConfigs: (signal?: AbortSignal) =>
      request<SshConfigurationList>("GET", "/ssh-configs", { signal }),

    createSshConfig: (payload: CreateSshConfigurationRequest) =>
      request<SshConfigurationRecord>("POST", "/ssh-configs", { body: payload }),

    updateSshConfig: (configId: string, payload: UpdateSshConfigurationRequest) =>
      request<SshConfigurationRecord>("PATCH", `/ssh-configs/${encodeURIComponent(configId)}`, {
        body: payload,
      }),

    deleteSshConfig: (configId: string) =>
      request<void>("DELETE", `/ssh-configs/${encodeURIComponent(configId)}`),

    // The MCP library is a curated catalog served by the binary; servers are
    // saved into config.toml, keyed by name, and parsed when a session starts.
    getMcpLibrary: (signal?: AbortSignal) =>
      request<McpLibraryResponse>("GET", "/mcp_library/library", { signal }),

    listMcpServers: (signal?: AbortSignal) =>
      request<McpServerList>("GET", "/mcp_library/servers", { signal }),

    createMcpServer: (payload: CreateMcpServerRequest) =>
      request<McpServerView>("POST", "/mcp_library/servers", { body: payload }),

    updateMcpServer: (serverName: string, payload: UpdateMcpServerRequest) =>
      request<McpServerView>("PATCH", `/mcp_library/servers/${encodeURIComponent(serverName)}`, {
        body: payload,
      }),

    deleteMcpServer: (serverName: string) =>
      request<void>("DELETE", `/mcp_library/servers/${encodeURIComponent(serverName)}`),

    /** Connects and lists tools without saving anything. */
    testMcpServer: (payload: TestMcpServerRequest) =>
      request<TestMcpServerResponse>("POST", "/mcp_library/servers/test", {
        body: payload,
      }),

    getMcpOAuthStatus: (name: string, signal?: AbortSignal) =>
      request<McpOAuthStatusResponse>(
        "GET",
        `/mcp_library/servers/${encodeURIComponent(name)}/oauth/status`,
        { signal },
      ),
    configureMcpOAuth: (name: string, payload: ConfigureMcpOAuthRequest) =>
      request<McpOAuthStatusResponse>(
        "POST",
        `/mcp_library/servers/${encodeURIComponent(name)}/oauth/configure`,
        { body: payload },
      ),
    authenticateMcpOAuth: (name: string, payload: AuthenticateMcpOAuthRequest = {}) =>
      request<AuthenticateMcpOAuthResponse>(
        "POST",
        `/mcp_library/servers/${encodeURIComponent(name)}/oauth/authenticate`,
        { body: payload },
      ),
    logoutMcpOAuth: (name: string) =>
      request<McpOAuthStatusResponse>(
        "POST",
        `/mcp_library/servers/${encodeURIComponent(name)}/oauth/logout`,
      ),

    listMcpRuntimeStatus: (signal?: AbortSignal) =>
      request<McpRuntimeStatusList>("GET", "/mcp_library/servers/status", { signal }),

    connectMcpServer: (serverName: string) =>
      request<McpRuntimeStatus>(
        "POST",
        `/mcp_library/servers/${encodeURIComponent(serverName)}/connect`,
      ),

    disconnectMcpServer: (serverName: string) =>
      request<McpRuntimeStatus>(
        "POST",
        `/mcp_library/servers/${encodeURIComponent(serverName)}/disconnect`,
      ),

    reloadMcpServer: (serverName: string) =>
      request<McpRuntimeStatus>(
        "POST",
        `/mcp_library/servers/${encodeURIComponent(serverName)}/reload`,
      ),

    /** Resolves a saved configuration's credential and lists its models. */
    resolveModelConfig: (configId: string, signal?: AbortSignal) =>
      request<ResolvedModelConfiguration>(
        "POST",
        `/model-configs/${encodeURIComponent(configId)}/models`,
        { signal },
      ),

    resolveConfigFile: (path: string, signal?: AbortSignal) =>
      request<ResolvedModelConfiguration>("POST", "/model-configs/from-file", {
        body: { path },
        signal,
      }),

    listProjects: (signal?: AbortSignal) => request<ProjectList>("GET", "/projects", { signal }),

    createProject: (payload: CreateProjectRequest) =>
      request<ProjectRecord>("POST", "/projects", { body: payload }),

    updateProject: (projectId: string, payload: UpdateProjectRequest) =>
      request<ProjectRecord>("PATCH", `/projects/${encodeURIComponent(projectId)}`, {
        body: payload,
      }),

    /** Releases the project's sessions unless asked to delete them too. */
    deleteProject: (projectId: string, sessions: DeleteProjectSessions = "keep") =>
      request<DeleteProjectResponse>(
        "DELETE",
        `/projects/${encodeURIComponent(projectId)}?sessions=${sessions}`,
      ),

    assignSessionToProject: (projectId: string, payload: AssignSessionRequest) =>
      request<ProjectRecord>("POST", `/projects/${encodeURIComponent(projectId)}/sessions`, {
        body: payload,
      }),

    reorderProjects: (payload: ReorderProjectsRequest) =>
      request<ReorderProjectsResponse>("PUT", "/projects/order", { body: payload }),

    listSessions: (options: ListSessionsOptions = {}, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (options.workspaceStats) params.set("workspace_stats", "true");
      if (options.projectId) params.set("project_id", options.projectId);
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return request<ManagedSessionSummary[]>("GET", `/sessions${query}`, { signal });
    },

    getSession: (id: string, options: SessionSnapshotOptions = {}) =>
      nacClient.getSession(id, options),

    createSession: (payload: CreateSessionRequest) =>
      request<SessionSnapshotResponse>("POST", "/sessions", { body: payload }),

    deleteSession: (id: string) => request<void>("DELETE", sessionPath(id)),

    launchDefaults: (payload: LaunchModelDefaultsRequest, signal?: AbortSignal) =>
      request<LaunchModelDefaults>("POST", "/sessions/launch-defaults", {
        body: payload,
        signal,
      }),

    updatePresentation: (id: string, payload: UpdateSessionPresentationRequest) =>
      request<SessionSummarySnapshot>("PUT", `${sessionPath(id)}/presentation`, {
        body: payload,
      }),

    reorderSessions: (payload: ReorderSessionsRequest) =>
      request<ReorderSessionsResponse>("PUT", "/sessions/order", {
        body: payload,
      }),

    getConfig: (id: string, signal?: AbortSignal) =>
      request<RawSessionConfig>("GET", `${sessionPath(id)}/config`, { signal }),

    getPermissions: (id: string, signal?: AbortSignal) =>
      request<PermissionStateResponse>("GET", `${sessionPath(id)}/permissions`, { signal }),

    replyPermission: (id: string, requestId: string, reply: PermissionReply) =>
      request<void>("POST", `${sessionPath(id)}/permissions/${encodeURIComponent(requestId)}`, {
        body: { reply },
      }),

    setPermissionApprovalMode: (id: string, mode: PermissionApprovalMode) =>
      request<void>("PUT", `${sessionPath(id)}/permissions/mode`, {
        body: { mode },
      }),

    deletePermissionGrant: (id: string, grantId: string) =>
      request<void>(
        "DELETE",
        `${sessionPath(id)}/permissions/grants/${encodeURIComponent(grantId)}`,
      ),

    getGoal: (id: string, signal?: AbortSignal) =>
      request<SessionGoalRecord | null>("GET", `${sessionPath(id)}/goal`, { signal }),

    createGoal: (id: string, payload: CreateGoalRequest) =>
      request<SessionGoalRecord>("POST", `${sessionPath(id)}/goal`, { body: payload }),

    updateGoal: (id: string, goalId: string, payload: UpdateGoalRequest) =>
      request<SessionGoalRecord>("PATCH", `${sessionPath(id)}/goal/${encodeURIComponent(goalId)}`, {
        body: payload,
      }),

    clearGoal: (id: string, goalId: string, expectedVersion: number) =>
      request<void>("DELETE", `${sessionPath(id)}/goal/${encodeURIComponent(goalId)}`, {
        body: { expected_version: expectedVersion },
      }),

    listInbox: (id: string, signal?: AbortSignal) =>
      request<InboxItem[]>("GET", `${sessionPath(id)}/inbox`, { signal }),

    createInboxItem: (id: string, delivery: InboxDelivery, prompt: string) =>
      request<InboxItem>("POST", `${sessionPath(id)}/inbox`, {
        body: { delivery, prompt },
      }),

    updateInboxItem: (
      id: string,
      itemId: number,
      expectedVersion: number,
      delivery: InboxDelivery,
    ) =>
      request<InboxItem>("PATCH", `${sessionPath(id)}/inbox/${itemId}`, {
        body: { expected_version: expectedVersion, delivery },
      }),

    cancelInboxItem: (id: string, itemId: number, expectedVersion: number) =>
      request<InboxItem>("DELETE", `${sessionPath(id)}/inbox/${itemId}`, {
        body: { expected_version: expectedVersion },
      }),

    listTraditionalChildren: (id: string, signal?: AbortSignal) =>
      request<TraditionalChildRecord[]>("GET", `${sessionPath(id)}/children`, { signal }),

    startTraditionalChild: (id: string, payload: StartTraditionalChildRequest) =>
      request<TraditionalChildRecord>("POST", `${sessionPath(id)}/children`, { body: payload }),

    getTraditionalChild: (id: string, childId: string, signal?: AbortSignal) =>
      request<TraditionalChildRecord>(
        "GET",
        `${sessionPath(id)}/children/${encodeURIComponent(childId)}`,
        { signal },
      ),

    cancelTraditionalChild: (id: string, childId: string) =>
      request<TraditionalChildRecord>(
        "POST",
        `${sessionPath(id)}/children/${encodeURIComponent(childId)}/cancel`,
      ),

    listManagedOrchestrators: (id: string, signal?: AbortSignal) =>
      request<ManagedOrchestratorRecord[]>("GET", `${sessionPath(id)}/orchestrators`, { signal }),

    startManagedOrchestrator: (id: string, payload: StartManagedOrchestratorRequest) =>
      request<ManagedOrchestratorRecord>("POST", `${sessionPath(id)}/orchestrators`, {
        body: payload,
      }),

    getManagedOrchestrator: (id: string, orchestratorId: string, signal?: AbortSignal) =>
      request<ManagedOrchestratorRecord>(
        "GET",
        `${sessionPath(id)}/orchestrators/${encodeURIComponent(orchestratorId)}`,
        { signal },
      ),

    cancelManagedOrchestrator: (id: string, orchestratorId: string) =>
      request<ManagedOrchestratorRecord>(
        "POST",
        `${sessionPath(id)}/orchestrators/${encodeURIComponent(orchestratorId)}/cancel`,
      ),

    updateConfig: (id: string, payload: UpdateConfigRequest) =>
      request<void>("PATCH", `${sessionPath(id)}/config`, { body: payload }),

    getMessages: (id: string, options: MessagesPageOptions = {}) => {
      const params = new URLSearchParams();
      if (options.before !== undefined) params.set("before", String(options.before));
      if (options.limit !== undefined) params.set("limit", String(options.limit));
      if (options.includeSystem) params.set("include_system", "true");
      const query = params.toString();
      return request<MessagesPageResponse>(
        "GET",
        `${sessionPath(id)}/messages${query ? `?${query}` : ""}`,
        { signal: options.signal },
      );
    },

    getThreadEvents: (id: string, threadName: string, options: ThreadEventsOptions = {}) => {
      const params = new URLSearchParams();
      if (options.beforeId !== undefined) {
        params.set("before_id", String(options.beforeId));
      }
      if (options.limit !== undefined) params.set("limit", String(options.limit));
      const query = params.toString();
      return request<ThreadEventPage>(
        "GET",
        `${sessionPath(id)}/threads/${encodeURIComponent(threadName)}/events${
          query ? `?${query}` : ""
        }`,
        { signal: options.signal },
      );
    },

    getWorkspaceDiff: (
      id: string,
      path: string,
      { stage = "all", context = 3, revision, signal }: WorkspaceDiffOptions = {},
    ) => {
      const params = new URLSearchParams({
        path,
        stage,
        context: String(context),
      });
      if (revision != null) params.set("revision", String(revision));
      return request<WorkspaceFileDiff>(
        "GET",
        `${sessionPath(id)}/workspace/diff?${params.toString()}`,
        { signal },
      );
    },

    getWorkspaceFiles: (id: string, revision: number | null, signal?: AbortSignal) => {
      const query = revision == null ? "" : `?revision=${revision}`;
      return request<WorkspaceFileList>("GET", `${sessionPath(id)}/workspace/files${query}`, {
        signal,
      });
    },

    getWorkspaceFile: (id: string, path: string, revision: number | null, signal?: AbortSignal) => {
      const params = new URLSearchParams({ path });
      if (revision != null) params.set("revision", String(revision));
      return request<WorkspaceFileContent>(
        "GET",
        `${sessionPath(id)}/workspace/file?${params.toString()}`,
        { signal },
      );
    },

    /** Ask nac-web to open a local workspace path with the OS default handler. */
    openWorkspacePath: (id: string, path: string) =>
      request<OpenWorkspacePathResult>("POST", `${sessionPath(id)}/workspace/open`, {
        body: { path },
      }),

    getWorkspaceRevisions: (id: string, signal?: AbortSignal) =>
      request<WorkspaceRevision[]>("GET", `${sessionPath(id)}/workspace/revisions`, { signal }),

    getWorkspaceRevisionChanges: (id: string, revision: number, signal?: AbortSignal) =>
      request<WorkspaceRevisionChanges>(
        "GET",
        `${sessionPath(id)}/workspace/revisions/${revision}/changes`,
        { signal },
      ),

    getBranches: (id: string, signal?: AbortSignal) =>
      request<BranchList>("GET", `${sessionPath(id)}/workspace/branches`, {
        signal,
      }),

    switchBranch: (id: string, body: SwitchBranchRequest) =>
      request<BranchList>("POST", `${sessionPath(id)}/workspace/branches`, {
        body,
      }),

    commitWorkspace: (id: string, body: CommitWorkspaceRequest) =>
      request<CommitOutcome>("POST", `${sessionPath(id)}/workspace/commit`, {
        body,
      }),

    submitRun: (id: string, prompt: string, signal?: AbortSignal) =>
      nacClient.submitPrompt(id, prompt, signal),

    cancelActiveRun: (id: string) => request<void>("POST", `${sessionPath(id)}/cancel-active-run`),

    cancelExactRun: (id: string, runId: string) =>
      request<void>("POST", `${sessionPath(id)}/runs/${encodeURIComponent(runId)}/cancel`),

    compactSession: (id: string) =>
      request<CompactSessionResponse>("POST", `${sessionPath(id)}/compact`),

    revertSession: (id: string, messageIdx: number) =>
      request<RevertSessionResponse>("POST", `${sessionPath(id)}/revert`, {
        body: { message_idx: messageIdx },
      }),

    regenerateRun: (id: string, messageIdx: number) =>
      request<SubmitPromptResponse>("POST", `${sessionPath(id)}/regenerate`, {
        body: { message_idx: messageIdx },
      }),

    forkSession: (id: string, messageIdx: number) =>
      request<ForkSessionResponse>("POST", `${sessionPath(id)}/fork`, {
        body: { message_idx: messageIdx },
      }),

    dismissSessionFork: (id: string, forkId: string) =>
      request<void>("DELETE", `${sessionPath(id)}/forks/${encodeURIComponent(forkId)}`),

    steerOrchestrator: (id: string, instruction: string) =>
      request<OrchestratorSteeringResponse>("POST", `${sessionPath(id)}/steering`, {
        body: { instruction },
      }),

    steerThread: (id: string, threadName: string, instruction: string) =>
      request<ThreadSteeringResponse>(
        "POST",
        `${sessionPath(id)}/threads/${encodeURIComponent(threadName)}/steering`,
        { body: { instruction } },
      ),

    getRecentEvents: (
      id: string,
      options: {
        cursor?: SessionEventBoundary;
        limit?: number;
        signal?: AbortSignal;
      } = {},
    ) => nacClient.getRecentEvents(id, options),
  };
}

export type NacApi = ReturnType<typeof createNacApi>;
