import type { SshTarget, WorkspaceDiffStage } from "@/app/types/api";

export type BrowseKind = "directory" | "toml" | "file";

/** How often the session list is refreshed; the list has no event stream. */
export const SESSIONS_POLL_MS = 5000;
export const WORKSPACE_STATS_POLL_MS = 30_000;

export const queryKeys = {
  storeInfo: ["store"] as const,
  managedHostStatus: ["managed-host-status"] as const,
  managedGitHub: ["managed-github"] as const,
  managedSecrets: ["managed-secrets"] as const,
  sandboxAvailability: ["sandbox-availability"] as const,
  sandboxActivity: ["sandbox-activity"] as const,
  credentials: ["credentials"] as const,
  managedAuth: ["managed-auth"] as const,
  modelConfigs: ["model-configs"] as const,
  sshConfigs: ["ssh-configs"] as const,
  mcpLibrary: ["mcp-library"] as const,
  mcpServers: ["mcp-servers"] as const,
  browse: (path: string, kind: BrowseKind, hidden: boolean) =>
    ["fs-browse", { path, kind, hidden }] as const,
  sshBrowse: (target: SshTarget, path: string, hidden = false) =>
    [
      "ssh-browse",
      {
        host: target.ssh_host,
        port: target.ssh_port ?? null,
        identityFile: target.ssh_identity_file ?? null,
        path,
        hidden,
      },
    ] as const,
  providerModels: (backend: string, apiKey: string, baseUrl: string) =>
    ["provider-models", { backend, apiKey, baseUrl }] as const,
  storedKeyProviderModels: (backend: string, apiKeyEnv: string, baseUrl: string) =>
    ["stored-key-provider-models", { backend, apiKeyEnv, baseUrl }] as const,
  managedProviderModels: (backend: string) => ["managed-provider-models", backend] as const,
  managedProviderModelsAll: ["managed-provider-models"] as const,
  modelCatalog: ["model-catalog"] as const,
  slashCommands: ["slash-commands"] as const,
  resolvedModelConfig: (configId: string) => ["model-config-resolved", configId] as const,
  resolvedModelConfigsAll: ["model-config-resolved"] as const,
  resolvedConfigFile: (path: string) => ["config-file-resolved", path] as const,
  resolvedConfigFilesAll: ["config-file-resolved"] as const,
  projects: ["projects"] as const,
  sessions: (workspaceStats: boolean) => ["sessions", { workspaceStats }] as const,
  sessionRoot: (id: string) => ["session", id] as const,
  sessionSnapshot: (id: string) => ["session", id, "snapshot"] as const,
  sessionSkills: (id: string) => ["session", id, "skills"] as const,
  sessionsAll: ["sessions"] as const,
  threadEventsRoot: (id: string) => ["session", id, "thread-events"] as const,
  threadEvents: (id: string, threadName: string) =>
    ["session", id, "thread-events", threadName] as const,
  sessionConfig: (id: string) => ["session", id, "config"] as const,
  sessionPermissions: (id: string) => ["session", id, "permissions"] as const,
  sessionGoal: (id: string) => ["session", id, "goal"] as const,
  sessionInbox: (id: string) => ["session", id, "inbox"] as const,
  traditionalChildren: (id: string) => ["session", id, "children"] as const,
  managedOrchestrators: (id: string) => ["session", id, "orchestrators"] as const,
  workspaceDiff: (
    id: string,
    path: string,
    stage: WorkspaceDiffStage | "all",
    context: number,
    revision: number | null,
  ) => ["session", id, "workspace-diff", { path, stage, context, revision }] as const,
  workspaceDiffRoot: (id: string) => ["session", id, "workspace-diff"] as const,
  branches: (id: string) => ["session", id, "branches"] as const,
  workspaceFiles: (id: string, revision: number | null) =>
    ["session", id, "workspace-files", { revision }] as const,
  workspaceFilesRoot: (id: string) => ["session", id, "workspace-files"] as const,
  workspaceFile: (id: string, path: string, revision: number | null) =>
    ["session", id, "workspace-file", { path, revision }] as const,
  workspaceFileRoot: (id: string) => ["session", id, "workspace-file"] as const,
  workspaceRevisions: (id: string) => ["session", id, "revisions"] as const,
  workspaceRevisionChanges: (id: string, revision: number) =>
    ["session", id, "revisions", revision, "changes"] as const,
};
