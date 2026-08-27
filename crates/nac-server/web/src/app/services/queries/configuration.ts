import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/app/services/api";
import { queryKeys, type BrowseKind } from "@/app/services/queries/keys";
import type {
  BackendKind,
  BrowseListing,
  CreateMcpServerRequest,
  CreateModelConfigurationRequest,
  CreateSshConfigurationRequest,
  McpLibraryResponse,
  McpServerList,
  ModelCatalog,
  ModelConfigurationList,
  ProviderModelList,
  ResolvedModelConfiguration,
  SkillCatalogEntry,
  SlashCommandDefinition,
  SshConfigurationList,
  SshTarget,
  TestMcpServerRequest,
  UpdateMcpServerRequest,
  UpdateModelConfigurationRequest,
  UpdateSshConfigurationRequest,
} from "@/app/types/api";

/**
 * Directory listing from the machine running the server. Only fetched while
 * the picker is open, and never cached long: the filesystem moves under us.
 */
export function useBrowsePath(
  path: string | null,
  kind: BrowseKind,
  hidden: boolean,
  enabled: boolean,
) {
  return useQuery<BrowseListing>({
    queryKey: queryKeys.browse(path ?? "", kind, hidden),
    queryFn: ({ signal }) => api.browsePath(path, kind, hidden, signal),
    enabled,
    staleTime: 2000,
    retry: false,
  });
}

/**
 * The same listing from an SSH host. Only directories come back, so a remote
 * working directory is picked the way a local one is.
 */
export function useSshBrowsePath(
  target: SshTarget | null,
  path: string | null,
  hidden: boolean,
  enabled: boolean,
) {
  return useQuery<BrowseListing>({
    queryKey: queryKeys.sshBrowse(target ?? { ssh_host: "" }, path ?? "", hidden),
    queryFn: ({ signal }) => api.browseSshPath(target!, path, hidden, signal),
    enabled: enabled && Boolean(target?.ssh_host),
    staleTime: 2000,
    retry: false,
  });
}

/**
 * Opens the connection the launch form needs before it can offer anything
 * remote, and reports the login home so the form can start there.
 *
 * A mutation rather than a query because connecting is the user pressing a
 * button, and because the ssh connection it leaves behind is a side effect the
 * session created next reuses.
 */
export function useSshConnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (target: SshTarget) => api.browseSshPath(target, null),
    onSuccess: (listing, target) => {
      // Seeding the home listing means the picker opens without a second round
      // trip over a connection that was just paid for.
      client.setQueryData(queryKeys.sshBrowse(target, "", false), listing);
    },
  });
}

export function useSshConfigs() {
  return useQuery<SshConfigurationList>({
    queryKey: queryKeys.sshConfigs,
    queryFn: ({ signal }) => api.listSshConfigs(signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function useCreateSshConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSshConfigurationRequest) => api.createSshConfig(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sshConfigs });
    },
  });
}

export function useUpdateSshConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      configId,
      payload,
    }: {
      configId: string;
      payload: UpdateSshConfigurationRequest;
    }) => api.updateSshConfig(configId, payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sshConfigs });
    },
  });
}

export function useDeleteSshConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (configId: string) => api.deleteSshConfig(configId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sshConfigs });
    },
  });
}

/**
 * Matches the server-side registry cache, so a fallback answer carrying only
 * the embedded entries is retried instead of pinned for the session.
 */
const MCP_LIBRARY_STALE_MS = 5 * 60 * 1000;

export function useMcpLibrary() {
  return useQuery<McpLibraryResponse>({
    queryKey: queryKeys.mcpLibrary,
    queryFn: ({ signal }) => api.getMcpLibrary(signal),
    staleTime: MCP_LIBRARY_STALE_MS,
    retry: false,
  });
}

export function useMcpServers() {
  return useQuery<McpServerList>({
    queryKey: queryKeys.mcpServers,
    queryFn: ({ signal }) => api.listMcpServers(signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function useCreateMcpServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateMcpServerRequest) => api.createMcpServer(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.mcpServers });
    },
  });
}

export function useUpdateMcpServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      serverName,
      payload,
    }: {
      serverName: string;
      payload: UpdateMcpServerRequest;
    }) => api.updateMcpServer(serverName, payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.mcpServers });
    },
  });
}

export function useDeleteMcpServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (serverName: string) => api.deleteMcpServer(serverName),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.mcpServers });
    },
  });
}

export function useTestMcpServer() {
  return useMutation({
    mutationFn: (payload: TestMcpServerRequest) => api.testMcpServer(payload),
  });
}

export function useModelConfigs() {
  return useQuery<ModelConfigurationList>({
    queryKey: queryKeys.modelConfigs,
    queryFn: ({ signal }) => api.listModelConfigs(signal),
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * The models an API key can reach, which is also how the key is validated: the
 * provider rejects the very same request when the key is wrong.
 *
 * The key appears in the query key so a corrected key refetches. That cache is
 * in memory for the lifetime of the tab and is never persisted.
 */
export function useProviderModels(
  backend: BackendKind,
  apiKey: string,
  baseUrl: string | null,
  enabled: boolean,
) {
  return useQuery<ProviderModelList>({
    queryKey: queryKeys.providerModels(backend, apiKey, baseUrl ?? ""),
    queryFn: () => api.listProviderModels({ backend, api_key: apiKey, base_url: baseUrl }),
    enabled: enabled && apiKey.length > 0,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 60_000,
  });
}

/**
 * The same check as `useProviderModels` for a key that is already on file: the
 * server resolves the name and asks the provider, so an editor that never held
 * the secret can still tell whether it still works and what it can reach.
 */
export function useStoredKeyProviderModels(
  backend: BackendKind,
  apiKeyEnv: string,
  baseUrl: string | null,
  enabled: boolean,
) {
  return useQuery<ProviderModelList>({
    queryKey: queryKeys.storedKeyProviderModels(backend, apiKeyEnv, baseUrl ?? ""),
    queryFn: () =>
      api.listProviderModels({
        backend,
        api_key_env: apiKeyEnv,
        base_url: baseUrl,
      }),
    enabled: enabled && apiKeyEnv.length > 0,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 60_000,
  });
}

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
export function useModelCatalog(enabled = true) {
  return useQuery<ModelCatalog>({
    queryKey: queryKeys.modelCatalog,
    queryFn: ({ signal }) => api.getModelCatalog(signal),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** Static slash-command metadata served from the core command registry. */
export function useSlashCommands() {
  return useQuery<SlashCommandDefinition[]>({
    queryKey: queryKeys.slashCommands,
    queryFn: ({ signal }) => api.listCommands(signal),
    staleTime: Infinity,
    retry: false,
  });
}

/** Skills discovered by the service currently attached to this session. */
export function useSessionSkills(sessionId: string) {
  return useQuery<SkillCatalogEntry[]>({
    queryKey: queryKeys.sessionSkills(sessionId),
    queryFn: ({ signal }) => api.listSessionSkills(sessionId, signal),
    refetchOnMount: "always",
    retry: false,
  });
}

/**
 * A saved configuration or a `config.toml`, checked end to end by the server:
 * the credential resolves and the provider answers with its model list.
 */
export function useResolvedModelConfig(configId: string | null, filePath: string) {
  const path = filePath.trim();
  return useQuery<ResolvedModelConfiguration>({
    queryKey: configId
      ? queryKeys.resolvedModelConfig(configId)
      : queryKeys.resolvedConfigFile(path),
    queryFn: () => (configId ? api.resolveModelConfig(configId) : api.resolveConfigFile(path)),
    enabled: Boolean(configId ?? path),
    retry: false,
    staleTime: 60_000,
  });
}

export function useCreateModelConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateModelConfigurationRequest) => api.createModelConfig(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.modelConfigs });
      // The server files the key under a generated credential name.
      void client.invalidateQueries({ queryKey: queryKeys.credentials });
    },
  });
}

export function useUpdateModelConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      configId,
      payload,
    }: {
      configId: string;
      payload: UpdateModelConfigurationRequest;
    }) => api.updateModelConfig(configId, payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.modelConfigs });
      // A replaced key is filed under a new generated name and the old one goes.
      void client.invalidateQueries({ queryKey: queryKeys.credentials });
    },
  });
}

export function useDeleteModelConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (configId: string) => api.deleteModelConfig(configId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.modelConfigs });
      void client.invalidateQueries({ queryKey: queryKeys.credentials });
    },
  });
}
