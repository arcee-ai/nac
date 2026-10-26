import type { SshTarget, WorkspaceDiffStage } from "../../types/api";
export type BrowseKind = "directory" | "toml" | "file";
/** How often the session list is refreshed; the list has no event stream. */
export declare const SESSIONS_POLL_MS = 5000;
export declare const WORKSPACE_STATS_POLL_MS = 30000;
export declare const queryKeys: {
    storeInfo: readonly ["store"];
    managedHostStatus: readonly ["managed-host-status"];
    managedGitHub: readonly ["managed-github"];
    managedSecrets: readonly ["managed-secrets"];
    sandboxAvailability: readonly ["sandbox-availability"];
    sandboxActivity: readonly ["sandbox-activity"];
    credentials: readonly ["credentials"];
    managedAuth: readonly ["managed-auth"];
    modelConfigs: readonly ["model-configs"];
    sshConfigs: readonly ["ssh-configs"];
    mcpLibrary: readonly ["mcp-library"];
    mcpServers: readonly ["mcp-servers"];
    mcpRuntime: readonly ["mcp-runtime"];
    browse: (path: string, kind: BrowseKind, hidden: boolean) => readonly ["fs-browse", {
        readonly path: string;
        readonly kind: BrowseKind;
        readonly hidden: boolean;
    }];
    sshBrowse: (target: SshTarget, path: string, hidden?: boolean) => readonly ["ssh-browse", {
        readonly host: string;
        readonly port: number | null;
        readonly identityFile: string | null;
        readonly path: string;
        readonly hidden: boolean;
    }];
    providerModels: (backend: string, credentialIdentity: string, baseUrl: string) => readonly ["provider-models", {
        readonly backend: string;
        readonly credentialIdentity: string;
        readonly baseUrl: string;
    }];
    storedKeyProviderModels: (backend: string, apiKeyEnv: string, baseUrl: string) => readonly ["stored-key-provider-models", {
        readonly backend: string;
        readonly apiKeyEnv: string;
        readonly baseUrl: string;
    }];
    managedProviderModels: (backend: string) => readonly ["managed-provider-models", string];
    managedProviderModelsAll: readonly ["managed-provider-models"];
    modelCatalog: readonly ["model-catalog"];
    slashCommands: readonly ["slash-commands"];
    sessionCommands: (id: string) => readonly ["session", string, "commands"];
    resolvedModelConfig: (configId: string) => readonly ["model-config-resolved", string];
    resolvedModelConfigsAll: readonly ["model-config-resolved"];
    resolvedConfigFile: (path: string) => readonly ["config-file-resolved", string];
    resolvedConfigFilesAll: readonly ["config-file-resolved"];
    projects: readonly ["projects"];
    sessions: (workspaceStats: boolean) => readonly ["sessions", {
        readonly workspaceStats: boolean;
    }];
    sessionRoot: (id: string) => readonly ["session", string];
    sessionSnapshot: (id: string) => readonly ["session", string, "snapshot"];
    sessionSkills: (id: string) => readonly ["session", string, "skills"];
    sessionsAll: readonly ["sessions"];
    threadEventsRoot: (id: string) => readonly ["session", string, "thread-events"];
    threadEvents: (id: string, threadName: string) => readonly ["session", string, "thread-events", string];
    sessionConfig: (id: string) => readonly ["session", string, "config"];
    sessionPermissions: (id: string) => readonly ["session", string, "permissions"];
    sessionGoal: (id: string) => readonly ["session", string, "goal"];
    sessionInbox: (id: string) => readonly ["session", string, "inbox"];
    traditionalChildren: (id: string) => readonly ["session", string, "children"];
    managedOrchestrators: (id: string) => readonly ["session", string, "orchestrators"];
    workspaceDiff: (id: string, path: string, stage: WorkspaceDiffStage | "all", context: number, revision: number | null) => readonly ["session", string, "workspace-diff", {
        readonly path: string;
        readonly stage: "all" | WorkspaceDiffStage;
        readonly context: number;
        readonly revision: number | null;
    }];
    workspaceDiffRoot: (id: string) => readonly ["session", string, "workspace-diff"];
    branches: (id: string) => readonly ["session", string, "branches"];
    workspaceFiles: (id: string, revision: number | null) => readonly ["session", string, "workspace-files", {
        readonly revision: number | null;
    }];
    workspaceFilesRoot: (id: string) => readonly ["session", string, "workspace-files"];
    workspaceFile: (id: string, path: string, revision: number | null) => readonly ["session", string, "workspace-file", {
        readonly path: string;
        readonly revision: number | null;
    }];
    workspaceFileRoot: (id: string) => readonly ["session", string, "workspace-file"];
    workspaceRevisions: (id: string) => readonly ["session", string, "revisions"];
    workspaceRevisionChanges: (id: string, revision: number) => readonly ["session", string, "revisions", number, "changes"];
};
