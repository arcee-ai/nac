import { ApiError } from "./nacClient.js";
export { ApiError };
const sessionPath = (id) => `/sessions/${encodeURIComponent(id)}`;
export function createNacApi(nacClient) {
    async function request(method, path, { body, headers, signal } = {}) {
        return nacClient.transport.request(method, path, { body, headers, signal });
    }
    return {
        health: (signal) => request("GET", "/health", { signal }),
        getStore: (signal) => request("GET", "/store", { signal }),
        getManagedStatus: (signal) => request("GET", "/managed/status", { signal }),
        getManagedGitIdentity: (signal) => request("GET", "/managed/github/git-identity", { signal }),
        updateManagedGitIdentity: (payload) => request("PUT", "/managed/github/git-identity", { body: payload }),
        getManagedGitHub: (signal) => request("GET", "/managed/github", { signal }),
        startManagedGitHubLogin: () => request("POST", "/managed/github/login"),
        pollManagedGitHubLogin: (loginId, signal) => request("GET", `/managed/github/login/${encodeURIComponent(loginId)}`, { signal }),
        cancelManagedGitHubLogin: (loginId) => request("DELETE", `/managed/github/login/${encodeURIComponent(loginId)}`),
        disconnectManagedGitHub: () => request("DELETE", "/managed/github"),
        listManagedGitHubRepositories: (signal) => request("GET", "/managed/github/repositories", { signal }),
        listManagedGitHubBranches: (owner, repository, signal) => request("GET", `/managed/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches`, { signal }),
        startManagedClone: (payload) => request("POST", "/managed/github/clone-operations", {
            body: payload,
        }),
        getManagedClone: (operationId, signal) => request("GET", `/managed/github/clone-operations/${encodeURIComponent(operationId)}`, { signal }),
        cancelManagedClone: (operationId) => request("DELETE", `/managed/github/clone-operations/${encodeURIComponent(operationId)}`),
        terminateTerminal: (sessionId, terminalId) => request("DELETE", `${sessionPath(sessionId)}/terminals/${encodeURIComponent(terminalId)}`),
        listManagedSecrets: (signal) => request("GET", "/managed/secrets", { signal }),
        putManagedSecret: (name, value) => request("PUT", `/managed/secrets/${encodeURIComponent(name)}`, {
            body: { value },
        }),
        deleteManagedSecret: (name) => request("DELETE", `/managed/secrets/${encodeURIComponent(name)}`),
        // Probing spawns podman subprocesses, so callers query this on demand (the
        // launch form's sandbox mode) rather than on page load.
        getSandboxAvailability: (signal) => request("GET", "/sandbox/availability", { signal }),
        // Sandbox setup in progress for one launch, or null when idle. The key is
        // the launch id sent with the create request, so concurrent launches never
        // show each other's phase.
        getSandboxActivity: (key, signal) => request("GET", `/sandbox/activity?${new URLSearchParams({ key })}`, {
            signal,
        }),
        // Credentials are write-only: the value is sent to the server and never
        // read back, so the UI only ever learns which names have a key stored.
        listCredentials: (signal) => request("GET", "/credentials", { signal }),
        storeCredential: (name, value) => request("PUT", `/credentials/${encodeURIComponent(name)}`, {
            body: { value },
        }),
        /** Files a key under a server-generated name and reports what it was. */
        storeGeneratedCredential: (value) => request("POST", "/credentials", { body: { value } }),
        deleteCredential: (name) => request("DELETE", `/credentials/${encodeURIComponent(name)}`),
        // Managed providers sign in with a device login: the server hands back a
        // code to show, waits for the browser approval on its own, and the outcome
        // is collected by polling.
        listManagedAuth: (signal) => request("GET", "/auth", { signal }),
        startManagedLogin: (provider) => request("POST", `/auth/${encodeURIComponent(provider)}/login`),
        pollManagedLogin: (provider, loginId, signal) => request("GET", `/auth/${encodeURIComponent(provider)}/login/${encodeURIComponent(loginId)}`, { signal }),
        cancelManagedLogin: (provider, loginId) => request("DELETE", `/auth/${encodeURIComponent(provider)}/login/${encodeURIComponent(loginId)}`),
        managedLogout: (provider) => request("DELETE", `/auth/${encodeURIComponent(provider)}`),
        // Browsers withhold absolute paths from every file-picking API, so a local
        // path is chosen against the filesystem the server sees.
        browsePath: (path, kind = "directory", hidden = false, signal) => {
            const query = new URLSearchParams({ kind });
            if (path)
                query.set("path", path);
            if (hidden)
                query.set("hidden", "true");
            return request("GET", `/fs/browse?${query.toString()}`, { signal });
        },
        /**
         * The same listing for a directory on an SSH host. Also the connection test
         * the launch form runs first: only a working connection can answer.
         */
        browseSshPath: (target, path, hidden = false, signal) => request("POST", "/ssh/browse", {
            body: { ...target, path, hidden },
            signal,
        }),
        /** Validates the key as a side effect: a bad key cannot list models. */
        listProviderModels: (payload, signal) => request("POST", "/providers/models", { body: payload, signal }),
        /**
         * The server's own catalog: limits, prices and effort support for the models
         * it knows about. Local and credential-free, so it answers for every provider
         * at once — unlike `listProviderModels`, which asks one provider.
         */
        getModelCatalog: (signal) => request("GET", "/models", { signal }),
        listCommands: (signal) => request("GET", "/commands", { signal }),
        listSessionCommands: (sessionId, signal) => request("GET", `/sessions/${encodeURIComponent(sessionId)}/commands`, { signal }),
        listSessionSkills: (sessionId, signal) => request("GET", `/sessions/${encodeURIComponent(sessionId)}/skills`, {
            signal,
        }),
        listModelConfigs: (signal) => request("GET", "/model-configs", { signal }),
        createModelConfig: (payload) => request("POST", "/model-configs", { body: payload }),
        updateModelConfig: (configId, payload) => request("PATCH", `/model-configs/${encodeURIComponent(configId)}`, {
            body: payload,
        }),
        deleteModelConfig: (configId) => request("DELETE", `/model-configs/${encodeURIComponent(configId)}`),
        listSshConfigs: (signal) => request("GET", "/ssh-configs", { signal }),
        createSshConfig: (payload) => request("POST", "/ssh-configs", { body: payload }),
        updateSshConfig: (configId, payload) => request("PATCH", `/ssh-configs/${encodeURIComponent(configId)}`, {
            body: payload,
        }),
        deleteSshConfig: (configId) => request("DELETE", `/ssh-configs/${encodeURIComponent(configId)}`),
        // The MCP library is a curated catalog served by the binary; servers are
        // saved into config.toml, keyed by name, and parsed when a session starts.
        getMcpLibrary: (signal) => request("GET", "/mcp_library/library", { signal }),
        listMcpServers: (signal) => request("GET", "/mcp_library/servers", { signal }),
        createMcpServer: (payload) => request("POST", "/mcp_library/servers", { body: payload }),
        updateMcpServer: (serverName, payload) => request("PATCH", `/mcp_library/servers/${encodeURIComponent(serverName)}`, {
            body: payload,
        }),
        deleteMcpServer: (serverName) => request("DELETE", `/mcp_library/servers/${encodeURIComponent(serverName)}`),
        /** Connects and lists tools without saving anything. */
        testMcpServer: (payload) => request("POST", "/mcp_library/servers/test", {
            body: payload,
        }),
        getMcpOAuthStatus: (name, signal) => request("GET", `/mcp_library/servers/${encodeURIComponent(name)}/oauth/status`, { signal }),
        configureMcpOAuth: (name, payload) => request("POST", `/mcp_library/servers/${encodeURIComponent(name)}/oauth/configure`, { body: payload }),
        authenticateMcpOAuth: (name, payload = {}) => request("POST", `/mcp_library/servers/${encodeURIComponent(name)}/oauth/authenticate`, { body: payload }),
        logoutMcpOAuth: (name) => request("POST", `/mcp_library/servers/${encodeURIComponent(name)}/oauth/logout`),
        listMcpRuntimeStatus: (signal) => request("GET", "/mcp_library/servers/status", { signal }),
        connectMcpServer: (serverName) => request("POST", `/mcp_library/servers/${encodeURIComponent(serverName)}/connect`),
        disconnectMcpServer: (serverName) => request("POST", `/mcp_library/servers/${encodeURIComponent(serverName)}/disconnect`),
        reloadMcpServer: (serverName) => request("POST", `/mcp_library/servers/${encodeURIComponent(serverName)}/reload`),
        /** Resolves a saved configuration's credential and lists its models. */
        resolveModelConfig: (configId, signal) => request("POST", `/model-configs/${encodeURIComponent(configId)}/models`, { signal }),
        resolveConfigFile: (path, signal) => request("POST", "/model-configs/from-file", {
            body: { path },
            signal,
        }),
        listProjects: (signal) => request("GET", "/projects", { signal }),
        createProject: (payload) => request("POST", "/projects", { body: payload }),
        updateProject: (projectId, payload) => request("PATCH", `/projects/${encodeURIComponent(projectId)}`, {
            body: payload,
        }),
        /** Releases the project's sessions unless asked to delete them too. */
        deleteProject: (projectId, sessions = "keep") => request("DELETE", `/projects/${encodeURIComponent(projectId)}?sessions=${sessions}`),
        assignSessionToProject: (projectId, payload) => request("POST", `/projects/${encodeURIComponent(projectId)}/sessions`, {
            body: payload,
        }),
        reorderProjects: (payload) => request("PUT", "/projects/order", { body: payload }),
        listSessions: (options = {}, signal) => {
            const params = new URLSearchParams();
            if (options.workspaceStats)
                params.set("workspace_stats", "true");
            if (options.projectId)
                params.set("project_id", options.projectId);
            const query = params.size > 0 ? `?${params.toString()}` : "";
            return request("GET", `/sessions${query}`, { signal });
        },
        getSession: (id, options = {}) => nacClient.getSession(id, options),
        createSession: (payload) => request("POST", "/sessions", { body: payload }),
        deleteSession: (id) => request("DELETE", sessionPath(id)),
        launchDefaults: (payload, signal) => request("POST", "/sessions/launch-defaults", {
            body: payload,
            signal,
        }),
        updatePresentation: (id, payload) => request("PUT", `${sessionPath(id)}/presentation`, {
            body: payload,
        }),
        reorderSessions: (payload) => request("PUT", "/sessions/order", {
            body: payload,
        }),
        getConfig: (id, signal) => request("GET", `${sessionPath(id)}/config`, { signal }),
        getPermissions: (id, signal) => request("GET", `${sessionPath(id)}/permissions`, { signal }),
        replyPermission: (id, requestId, reply) => request("POST", `${sessionPath(id)}/permissions/${encodeURIComponent(requestId)}`, {
            body: { reply },
        }),
        setPermissionApprovalMode: (id, mode) => request("PUT", `${sessionPath(id)}/permissions/mode`, {
            body: { mode },
        }),
        deletePermissionGrant: (id, grantId) => request("DELETE", `${sessionPath(id)}/permissions/grants/${encodeURIComponent(grantId)}`),
        getGoal: (id, signal) => request("GET", `${sessionPath(id)}/goal`, { signal }),
        createGoal: (id, payload) => request("POST", `${sessionPath(id)}/goal`, { body: payload }),
        updateGoal: (id, goalId, payload) => request("PATCH", `${sessionPath(id)}/goal/${encodeURIComponent(goalId)}`, {
            body: payload,
        }),
        clearGoal: (id, goalId, expectedVersion) => request("DELETE", `${sessionPath(id)}/goal/${encodeURIComponent(goalId)}`, {
            body: { expected_version: expectedVersion },
        }),
        listInbox: (id, signal) => request("GET", `${sessionPath(id)}/inbox`, { signal }),
        createInboxItem: (id, delivery, prompt) => request("POST", `${sessionPath(id)}/inbox`, {
            body: { delivery, prompt },
        }),
        updateInboxItem: (id, itemId, expectedVersion, delivery) => request("PATCH", `${sessionPath(id)}/inbox/${itemId}`, {
            body: { expected_version: expectedVersion, delivery },
        }),
        cancelInboxItem: (id, itemId, expectedVersion) => request("DELETE", `${sessionPath(id)}/inbox/${itemId}`, {
            body: { expected_version: expectedVersion },
        }),
        listTraditionalChildren: (id, signal) => request("GET", `${sessionPath(id)}/children`, { signal }),
        startTraditionalChild: (id, payload) => request("POST", `${sessionPath(id)}/children`, { body: payload }),
        getTraditionalChild: (id, childId, signal) => request("GET", `${sessionPath(id)}/children/${encodeURIComponent(childId)}`, { signal }),
        cancelTraditionalChild: (id, childId) => request("POST", `${sessionPath(id)}/children/${encodeURIComponent(childId)}/cancel`),
        listManagedOrchestrators: (id, signal) => request("GET", `${sessionPath(id)}/orchestrators`, { signal }),
        startManagedOrchestrator: (id, payload) => request("POST", `${sessionPath(id)}/orchestrators`, {
            body: payload,
        }),
        getManagedOrchestrator: (id, orchestratorId, signal) => request("GET", `${sessionPath(id)}/orchestrators/${encodeURIComponent(orchestratorId)}`, { signal }),
        cancelManagedOrchestrator: (id, orchestratorId) => request("POST", `${sessionPath(id)}/orchestrators/${encodeURIComponent(orchestratorId)}/cancel`),
        updateConfig: (id, payload) => request("PATCH", `${sessionPath(id)}/config`, { body: payload }),
        getMessages: (id, options = {}) => {
            const params = new URLSearchParams();
            if (options.before !== undefined)
                params.set("before", String(options.before));
            if (options.limit !== undefined)
                params.set("limit", String(options.limit));
            if (options.includeSystem)
                params.set("include_system", "true");
            const query = params.toString();
            return request("GET", `${sessionPath(id)}/messages${query ? `?${query}` : ""}`, { signal: options.signal });
        },
        getThreadEvents: (id, threadName, options = {}) => {
            const params = new URLSearchParams();
            if (options.beforeId !== undefined) {
                params.set("before_id", String(options.beforeId));
            }
            if (options.limit !== undefined)
                params.set("limit", String(options.limit));
            const query = params.toString();
            return request("GET", `${sessionPath(id)}/threads/${encodeURIComponent(threadName)}/events${query ? `?${query}` : ""}`, { signal: options.signal });
        },
        getWorkspaceDiff: (id, path, { stage = "all", context = 3, revision, signal } = {}) => {
            const params = new URLSearchParams({
                path,
                stage,
                context: String(context),
            });
            if (revision != null)
                params.set("revision", String(revision));
            return request("GET", `${sessionPath(id)}/workspace/diff?${params.toString()}`, { signal });
        },
        getWorkspaceFiles: (id, revision, signal) => {
            const query = revision == null ? "" : `?revision=${revision}`;
            return request("GET", `${sessionPath(id)}/workspace/files${query}`, {
                signal,
            });
        },
        getWorkspaceFile: (id, path, revision, signal) => {
            const params = new URLSearchParams({ path });
            if (revision != null)
                params.set("revision", String(revision));
            return request("GET", `${sessionPath(id)}/workspace/file?${params.toString()}`, { signal });
        },
        /** Ask nac-web to open a local workspace path with the OS default handler. */
        openWorkspacePath: (id, path) => request("POST", `${sessionPath(id)}/workspace/open`, {
            body: { path },
        }),
        getWorkspaceRevisions: (id, signal) => request("GET", `${sessionPath(id)}/workspace/revisions`, { signal }),
        getWorkspaceRevisionChanges: (id, revision, signal) => request("GET", `${sessionPath(id)}/workspace/revisions/${revision}/changes`, { signal }),
        getBranches: (id, signal) => request("GET", `${sessionPath(id)}/workspace/branches`, {
            signal,
        }),
        switchBranch: (id, body) => request("POST", `${sessionPath(id)}/workspace/branches`, {
            body,
        }),
        commitWorkspace: (id, body) => request("POST", `${sessionPath(id)}/workspace/commit`, {
            body,
        }),
        submitRun: (id, prompt, signal) => nacClient.submitPrompt(id, prompt, signal),
        cancelActiveRun: (id) => request("POST", `${sessionPath(id)}/cancel-active-run`),
        cancelExactRun: (id, runId) => request("POST", `${sessionPath(id)}/runs/${encodeURIComponent(runId)}/cancel`),
        compactSession: (id) => request("POST", `${sessionPath(id)}/compact`),
        revertSession: (id, messageIdx) => request("POST", `${sessionPath(id)}/revert`, {
            body: { message_idx: messageIdx },
        }),
        regenerateRun: (id, messageIdx) => request("POST", `${sessionPath(id)}/regenerate`, {
            body: { message_idx: messageIdx },
        }),
        forkSession: (id, messageIdx) => request("POST", `${sessionPath(id)}/fork`, {
            body: { message_idx: messageIdx },
        }),
        dismissSessionFork: (id, forkId) => request("DELETE", `${sessionPath(id)}/forks/${encodeURIComponent(forkId)}`),
        steerOrchestrator: (id, instruction) => request("POST", `${sessionPath(id)}/steering`, {
            body: { instruction },
        }),
        steerThread: (id, threadName, instruction) => request("POST", `${sessionPath(id)}/threads/${encodeURIComponent(threadName)}/steering`, { body: { instruction } }),
        getRecentEvents: (id, options = {}) => nacClient.getRecentEvents(id, options),
    };
}
