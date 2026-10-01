import { Atom } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Effect } from "effect";
import type { AtomRegistry } from "effect/reactivity";

import {
  idleAtom,
  nacAtoms,
  refreshPrefixed,
  remoteAtom,
  resetPrefixed,
  type Remote,
} from "@/app/effect/remote";
import { apiEffect } from "@/app/services/api";
import { atomIds, type BrowseKind } from "@/app/services/queries/keys";
import type {
  BackendKind,
  BrowseListing,
  CreateMcpServerRequest,
  CreateModelConfigurationRequest,
  CreateSshConfigurationRequest,
  ModelCatalog,
  ProviderModelList,
  ResolvedModelConfiguration,
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
const browsePathFamily = Atom.family((id: string) => {
  const { kind, hidden, path } = decodeBrowse(id);
  return remoteAtom(id, () => apiEffect.browsePath(path || null, kind, hidden), {
    staleMs: 2_000,
    retry: false,
  });
});

export function browsePathAtom(
  path: string | null,
  kind: BrowseKind,
  hidden: boolean,
  enabled: boolean,
): Remote<BrowseListing> {
  if (!enabled) return idleAtom();
  return browsePathFamily(atomIds.browse(path ?? "", kind, hidden));
}

/**
 * The same listing from an SSH host. Only directories come back, so a remote
 * working directory is picked the way a local one is.
 */
const sshBrowseFamily = Atom.family((id: string) => {
  const { target, path, hidden } = decodeSshBrowse(id);
  return remoteAtom(id, () => apiEffect.browseSshPath(target, path, hidden), {
    staleMs: 2_000,
    retry: false,
  });
});

export function sshBrowsePathAtom(
  target: SshTarget | null,
  path: string | null,
  hidden: boolean,
  enabled: boolean,
): Remote<BrowseListing> {
  if (!enabled || !target?.ssh_host) return idleAtom();
  return sshBrowseFamily(sshBrowseId(target, path ?? "", hidden));
}

/**
 * Opens the connection the launch form needs before it can offer anything
 * remote, and reports the login home so the form can start there.
 *
 * A command rather than a read because connecting is the user pressing a
 * button, and because the ssh connection it leaves behind is a side effect the
 * session created next reuses.
 */
export const sshConnectAtom = nacAtoms.fn((target: SshTarget, get) =>
  apiEffect.browseSshPath(target, null).pipe(
    Effect.tap((listing) =>
      Effect.sync(() => {
        // Seeding the home listing means the picker opens without a second round
        // trip over a connection that was just paid for.
        get.set(sshBrowseFamily(sshBrowseId(target, "", false)), AsyncResult.success(listing));
      }),
    ),
  ),
);

export const sshConfigsAtom = remoteAtom(atomIds.sshConfigs, () => apiEffect.listSshConfigs(), {
  retry: false,
});

export const createSshConfigAtom = nacAtoms.fn((payload: CreateSshConfigurationRequest, get) =>
  apiEffect
    .createSshConfig(payload)
    .pipe(
      Effect.tap(() => Effect.promise(() => refreshPrefixed(get.registry, atomIds.sshConfigs))),
    ),
);

export const updateSshConfigAtom = nacAtoms.fn(
  (input: { configId: string; payload: UpdateSshConfigurationRequest }, get) =>
    apiEffect
      .updateSshConfig(input.configId, input.payload)
      .pipe(
        Effect.tap(() => Effect.promise(() => refreshPrefixed(get.registry, atomIds.sshConfigs))),
      ),
);

export const deleteSshConfigAtom = nacAtoms.fn((configId: string, get) =>
  apiEffect
    .deleteSshConfig(configId)
    .pipe(
      Effect.tap(() => Effect.promise(() => refreshPrefixed(get.registry, atomIds.sshConfigs))),
    ),
);

/**
 * Matches the server-side registry cache, so a fallback answer carrying only
 * the embedded entries is retried instead of pinned for the session.
 */
const MCP_LIBRARY_STALE_MS = 5 * 60 * 1000;

export const mcpLibraryAtom = remoteAtom(atomIds.mcpLibrary, () => apiEffect.getMcpLibrary(), {
  staleMs: MCP_LIBRARY_STALE_MS,
  retry: false,
});

export const mcpServersAtom = remoteAtom(atomIds.mcpServers, () => apiEffect.listMcpServers(), {
  retry: false,
});

const refreshMcp = (registry: AtomRegistry.AtomRegistry) =>
  Effect.promise(async () => {
    await refreshPrefixed(registry, atomIds.mcpServers);
    await refreshPrefixed(registry, atomIds.mcpRuntime);
  });

export const createMcpServerAtom = nacAtoms.fn((payload: CreateMcpServerRequest, get) =>
  apiEffect.createMcpServer(payload).pipe(Effect.tap(() => refreshMcp(get.registry))),
);

export const updateMcpServerAtom = nacAtoms.fn(
  (input: { serverName: string; payload: UpdateMcpServerRequest }, get) =>
    apiEffect
      .updateMcpServer(input.serverName, input.payload)
      .pipe(Effect.tap(() => refreshMcp(get.registry))),
);

export const deleteMcpServerAtom = nacAtoms.fn((serverName: string, get) =>
  apiEffect.deleteMcpServer(serverName).pipe(Effect.tap(() => refreshMcp(get.registry))),
);

export const testMcpServerAtom = nacAtoms.fn((payload: TestMcpServerRequest) =>
  apiEffect.testMcpServer(payload),
);

export const mcpRuntimeAtom = remoteAtom(
  atomIds.mcpRuntime,
  () => apiEffect.listMcpRuntimeStatus(),
  { staleMs: 5_000, retry: false },
);

export const mcpRuntimeActionAtom = nacAtoms.fn(
  (input: { serverName: string; action: "connect" | "disconnect" | "reload" }, get) => {
    const call =
      input.action === "connect"
        ? apiEffect.connectMcpServer(input.serverName)
        : input.action === "disconnect"
          ? apiEffect.disconnectMcpServer(input.serverName)
          : apiEffect.reloadMcpServer(input.serverName);
    return call.pipe(
      Effect.tap(() => Effect.promise(() => refreshPrefixed(get.registry, atomIds.mcpRuntime))),
    );
  },
);

export const modelConfigsAtom = remoteAtom(
  atomIds.modelConfigs,
  () => apiEffect.listModelConfigs(),
  { retry: false },
);

const PROVIDER_MODELS_STALE_MS = 5 * 60_000;

/**
 * The models an API key can reach, which is also how the key is validated: the
 * provider rejects the very same request when the key is wrong.
 *
 * The key is the family member after `atomIds.providerModels`, so a corrected
 * key refetches. That cache stays in memory for the lifetime of the tab and is
 * never persisted.
 */
const providerModelsFamily = Atom.family((id: string) => {
  const read = decodeProviderModelRead(id);
  return remoteAtom(
    id,
    () =>
      read.kind === "stored"
        ? apiEffect.listProviderModels({
            backend: read.backend,
            api_key_env: read.secret,
            base_url: read.baseUrl,
          })
        : apiEffect.listProviderModels({
            backend: read.backend,
            api_key: read.secret,
            base_url: read.baseUrl,
          }),
    { staleMs: PROVIDER_MODELS_STALE_MS, retry: false },
  );
});

export function providerModelsAtom(
  backend: BackendKind,
  apiKey: string,
  baseUrl: string | null,
  enabled: boolean,
): Remote<ProviderModelList> {
  if (!enabled || apiKey.length === 0) return idleAtom();
  return providerModelsFamily(providerModelReadId("typed", backend, baseUrl, apiKey));
}

/**
 * The same check as `providerModelsAtom` for a key that is already on file: the
 * server resolves the name and asks the provider, so an editor that never held
 * the secret can still tell whether it still works and what it can reach.
 */
export function storedKeyProviderModelsAtom(
  backend: BackendKind,
  apiKeyEnv: string,
  baseUrl: string | null,
  enabled: boolean,
): Remote<ProviderModelList> {
  if (!enabled || apiKeyEnv.length === 0) return idleAtom();
  return providerModelsFamily(providerModelReadId("stored", backend, baseUrl, apiKeyEnv));
}

/**
 * The server's model catalog: context windows, prices and the efforts each
 * model accepts. It only changes when the server reloads it, and a failure is
 * never fatal — every consumer falls back to showing the raw numbers.
 */
const modelCatalogRemote = remoteAtom(atomIds.modelCatalog, () => apiEffect.getModelCatalog(), {
  staleMs: 10 * 60_000,
  retry: false,
});

export function modelCatalogAtom(enabled = true): Remote<ModelCatalog> {
  return enabled ? modelCatalogRemote : idleAtom();
}

/** Prefix shared by every member of a family id. */
function familyPrefix(id: string): string {
  const separator = id.lastIndexOf("\0");
  return separator === -1 ? id : id.slice(0, separator);
}

/** Reconcile every cached projection derived from provider-account state. */
export async function refreshUnifiedProviderCatalog(
  registry: AtomRegistry.AtomRegistry,
): Promise<void> {
  resetPrefixed(registry, atomIds.managedProviderModelsAll);
  await refreshPrefixed(registry, atomIds.modelCatalog);
}

/** Reconcile every browser projection after a login is added or removed. */
export async function refreshProviderAuthentication(
  registry: AtomRegistry.AtomRegistry,
): Promise<void> {
  await Promise.all([
    refreshPrefixed(registry, atomIds.managedAuth),
    refreshUnifiedProviderCatalog(registry),
    refreshPrefixed(registry, familyPrefix(atomIds.resolvedModelConfig(""))),
    refreshPrefixed(registry, familyPrefix(atomIds.resolvedConfigFile(""))),
  ]);
}

/** Static slash-command metadata served from the core command registry. */
export const slashCommandsAtom = remoteAtom(atomIds.slashCommands, () => apiEffect.listCommands(), {
  staleMs: Number.POSITIVE_INFINITY,
  retry: false,
});

/** Session-scoped slash commands, including prompts discovered from mounted MCP servers. */
export const sessionCommandsAtom = Atom.family((sessionId: string) =>
  remoteAtom(atomIds.sessionCommands(sessionId), () => apiEffect.listSessionCommands(sessionId), {
    staleMs: 0,
    retry: false,
    refreshOnMount: "always",
  }),
);

/** Skills discovered by the service currently attached to this session. */
export const sessionSkillsAtom = Atom.family((sessionId: string) =>
  remoteAtom(atomIds.skills(sessionId), () => apiEffect.listSessionSkills(sessionId), {
    staleMs: 0,
    retry: false,
    refreshOnMount: "always",
  }),
);

const resolvedModelConfigFamily = Atom.family((configId: string) =>
  remoteAtom(atomIds.resolvedModelConfig(configId), () => apiEffect.resolveModelConfig(configId), {
    staleMs: 60_000,
    retry: false,
  }),
);

const resolvedConfigFileFamily = Atom.family((path: string) =>
  remoteAtom(atomIds.resolvedConfigFile(path), () => apiEffect.resolveConfigFile(path), {
    staleMs: 60_000,
    retry: false,
  }),
);

/**
 * A saved configuration or a `config.toml`, checked end to end by the server:
 * the credential resolves and the provider answers with its model list.
 */
export function resolvedModelConfigAtom(
  configId: string | null,
  filePath: string,
): Remote<ResolvedModelConfiguration> {
  const path = filePath.trim();
  if (configId) return resolvedModelConfigFamily(configId);
  if (path) return resolvedConfigFileFamily(path);
  return idleAtom();
}

function refreshSavedModelConfiguration(registry: AtomRegistry.AtomRegistry): Promise<void> {
  return Promise.all([
    refreshPrefixed(registry, atomIds.modelConfigs),
    refreshPrefixed(registry, atomIds.credentials),
    refreshUnifiedProviderCatalog(registry),
  ]).then(() => undefined);
}

export const createModelConfigAtom = nacAtoms.fn((payload: CreateModelConfigurationRequest, get) =>
  apiEffect.createModelConfig(payload).pipe(
    Effect.tap(() =>
      // The server files the key under a generated credential name.
      Effect.promise(() => refreshSavedModelConfiguration(get.registry)),
    ),
  ),
);

export const updateModelConfigAtom = nacAtoms.fn(
  (input: { configId: string; payload: UpdateModelConfigurationRequest }, get) =>
    apiEffect.updateModelConfig(input.configId, input.payload).pipe(
      Effect.tap(() =>
        // A replaced key is filed under a new generated name and the old one goes.
        Effect.promise(() => refreshSavedModelConfiguration(get.registry)),
      ),
    ),
);

export const deleteModelConfigAtom = nacAtoms.fn((configId: string, get) =>
  apiEffect
    .deleteModelConfig(configId)
    .pipe(Effect.tap(() => Effect.promise(() => refreshSavedModelConfiguration(get.registry)))),
);

function decodeBrowse(id: string): { kind: BrowseKind; hidden: boolean; path: string } {
  const parts = id.split("\0");
  return {
    kind: parts[1] as BrowseKind,
    hidden: parts[2] === "1",
    path: parts.slice(3).join("\0"),
  };
}

function sshBrowseId(target: SshTarget, path: string, hidden: boolean): string {
  return atomIds.sshBrowse(
    target.ssh_host,
    target.ssh_port ?? null,
    target.ssh_identity_file ?? null,
    path,
    hidden,
  );
}

function decodeSshBrowse(id: string): { target: SshTarget; path: string | null; hidden: boolean } {
  const parts = id.split("\0");
  const port = parts[2] ? Number(parts[2]) : null;
  const path = parts.slice(5).join("\0");
  return {
    target: {
      ssh_host: parts[1] ?? "",
      ssh_port: port,
      ssh_identity_file: parts[3] ? parts[3] : null,
    },
    path: path || null,
    hidden: parts[4] === "1",
  };
}

type ProviderModelKind = "typed" | "stored";

interface ProviderModelRead {
  kind: ProviderModelKind;
  backend: BackendKind;
  secret: string;
  baseUrl: string | null;
}

function providerModelReadId(
  kind: ProviderModelKind,
  backend: BackendKind,
  baseUrl: string | null,
  secret: string,
): string {
  return `${atomIds.providerModels(backend, baseUrl ?? "")}\0${kind}\0${secret}`;
}

function decodeProviderModelRead(id: string): ProviderModelRead {
  const parts = id.split("\0");
  const baseUrl = parts[2] ?? "";
  return {
    kind: parts[3] === "stored" ? "stored" : "typed",
    backend: (parts[1] ?? "") as BackendKind,
    secret: parts.slice(4).join("\0"),
    baseUrl: baseUrl.length > 0 ? baseUrl : null,
  };
}
