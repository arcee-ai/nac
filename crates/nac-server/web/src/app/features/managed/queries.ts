// Managed-host server state. Reads are remote atoms; writes are commands that
// refresh the matching id prefix.

import { Atom } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Effect } from "effect";
import type { AtomRegistry } from "effect/reactivity";

import {
  idleAtom,
  nacAtoms,
  patchRemote,
  refreshPrefixed,
  remoteAtom,
  valueOf,
  type Remote,
} from "@/app/effect/remote";
import { ClientRequestError } from "@/app/effect/errors";
import { readyProviderModelRequests } from "@/app/features/managed/model";
import {
  managedUpgradeIsActive,
  type ManagedUpgradeSnapshot,
} from "@/app/features/managed/upgrade";
import {
  decodeManagedUpgradeOperation,
  decodeManagedUpgradeSnapshot,
} from "@/app/features/managed/upgradeContract";
import { apiEffect } from "@/app/services/api";
import { atomIds } from "@/app/services/queries/keys";
import type {
  BackendKind,
  ManagedAuthList,
  ManagedGitHubStatus,
  ManagedHostStatus,
  ManagedSecretList,
  ModelCatalog,
  ProviderModel,
  ProviderModelList,
  ProviderModelsRequest,
} from "@/app/types/api";

const SEP = "\u0000";
const HOST_STATUS_POLL_MS = 15_000;
const UPGRADE_ACTIVE_POLL_MS = 1_000;
const UPGRADE_IDLE_POLL_MS = 15_000;
const PROVIDER_MODELS_STALE_MS = 5 * 60_000;

function whenEnabled<A>(enabled: boolean, atom: Remote<A>): Remote<A> {
  return enabled ? atom : idleAtom<A>();
}

function refreshPrefixes(registry: AtomRegistry.AtomRegistry, ...prefixes: string[]) {
  return Effect.promise(() =>
    Promise.all(prefixes.map((prefix) => refreshPrefixed(registry, prefix))).then(() => undefined),
  );
}

function decodeUpgrade<A>(decode: (value: unknown) => A) {
  return (value: unknown) =>
    Effect.try({
      try: () => decode(value),
      catch: (cause) => new ClientRequestError({ error: cause }),
    });
}

export const managedHostStatusAtom: Remote<ManagedHostStatus> = remoteAtom(
  atomIds.managedHostStatus,
  () => apiEffect.getManagedStatus(),
  { staleMs: 5_000, pollMs: HOST_STATUS_POLL_MS, retry: false },
);

const managedUpgradeSnapshotRemote: Remote<ManagedUpgradeSnapshot> = remoteAtom(
  atomIds.managedUpgrade,
  () =>
    apiEffect.getManagedUpgrade().pipe(Effect.flatMap(decodeUpgrade(decodeManagedUpgradeSnapshot))),
  {
    staleMs: 0,
    pollMs: (snapshot) =>
      snapshot?.operation && managedUpgradeIsActive(snapshot.operation.state)
        ? UPGRADE_ACTIVE_POLL_MS
        : UPGRADE_IDLE_POLL_MS,
    pollInBackground: true,
    retry: false,
  },
);

/** Skips the upgrade poll while the caller has not asked for it. */
export function managedUpgradeSnapshotAtom(enabled = true): Remote<ManagedUpgradeSnapshot> {
  return whenEnabled(enabled, managedUpgradeSnapshotRemote);
}

export const startManagedUpgradeAtom = nacAtoms.fn((idempotencyKey: string, get) =>
  apiEffect.startManagedUpgrade(idempotencyKey).pipe(
    Effect.flatMap(decodeUpgrade(decodeManagedUpgradeOperation)),
    Effect.tap((operation) =>
      Effect.sync(() => {
        patchRemote(get.registry, managedUpgradeSnapshotRemote, (snapshot) =>
          snapshot ? { ...snapshot, operation } : undefined,
        );
      }),
    ),
    Effect.tap(() => refreshPrefixes(get.registry, atomIds.managedUpgrade)),
  ),
);

const managedGitHubRemote: Remote<ManagedGitHubStatus> = remoteAtom(
  atomIds.managedGitHub,
  () => apiEffect.getManagedGitHub(),
  { retry: false },
);

export function managedGitHubAtom(enabled = true): Remote<ManagedGitHubStatus> {
  return whenEnabled(enabled, managedGitHubRemote);
}

const managedSecretsRemote: Remote<ManagedSecretList> = remoteAtom(
  atomIds.managedSecrets,
  () => apiEffect.listManagedSecrets(),
  { retry: false },
);

export function managedSecretsAtom(enabled = true): Remote<ManagedSecretList> {
  return whenEnabled(enabled, managedSecretsRemote);
}

function refreshSecrets(registry: AtomRegistry.AtomRegistry) {
  return refreshPrefixes(registry, atomIds.managedSecrets, atomIds.managedHostStatus);
}

export const putManagedSecretAtom = nacAtoms.fn((input: { name: string; value: string }, get) =>
  apiEffect
    .putManagedSecret(input.name, input.value)
    .pipe(Effect.tap(() => refreshSecrets(get.registry))),
);

export const deleteManagedSecretAtom = nacAtoms.fn((name: string, get) =>
  apiEffect.deleteManagedSecret(name).pipe(Effect.tap(() => refreshSecrets(get.registry))),
);

const managedAuthRemote: Remote<ManagedAuthList> = remoteAtom(
  atomIds.managedAuth,
  () => apiEffect.listManagedAuth(),
  { retry: false },
);

export function managedAuthAtom(enabled = true): Remote<ManagedAuthList> {
  return whenEnabled(enabled, managedAuthRemote);
}

/**
 * Family key for one provider-model read. A bare backend matches
 * `atomIds.managedProviderModels(backend)`. An endpoint is appended so two
 * base URLs for the same backend stay distinct and still refresh under
 * `atomIds.managedProviderModelsAll`.
 */
export function managedProviderModelsKey(request: {
  readonly backend: string;
  readonly base_url?: string | null;
  readonly api_key_env?: string | null;
}): string {
  const baseUrl = request.base_url || "";
  const apiKeyEnv = request.api_key_env || "";
  if (!baseUrl && !apiKeyEnv) return request.backend;
  return `${request.backend}${SEP}${baseUrl}${SEP}${apiKeyEnv}`;
}

function providerModelsRequest(key: string): ProviderModelsRequest {
  const [backend, baseUrl, apiKeyEnv] = key.split(SEP);
  return {
    backend: backend as BackendKind,
    ...(baseUrl ? { base_url: baseUrl } : {}),
    ...(apiKeyEnv ? { api_key_env: apiKeyEnv } : {}),
  };
}

function providerModelsId(request: ProviderModelsRequest): string {
  const id = atomIds.managedProviderModels(request.backend);
  if (!request.base_url && !request.api_key_env) return id;
  return `${id}${SEP}${request.base_url ?? ""}${SEP}${request.api_key_env ?? ""}`;
}

export const managedProviderModelsAtom = Atom.family((key: string): Remote<ProviderModelList> => {
  const request = providerModelsRequest(key);
  return remoteAtom(providerModelsId(request), () => apiEffect.listProviderModels(request), {
    retry: false,
    staleMs: PROVIDER_MODELS_STALE_MS,
  });
});

/** Replaces the single provider-model query, including its enabled gate. */
export function managedProviderModelsFor(
  backend: BackendKind | null,
  enabled: boolean,
  baseUrl: string | null = null,
): Remote<ProviderModelList> {
  if (!enabled || backend === null) return idleAtom<ProviderModelList>();
  return managedProviderModelsAtom(managedProviderModelsKey({ backend, base_url: baseUrl }));
}

/**
 * One subscription for every ready provider. Each member is a family atom, so
 * the React hook count does not grow with the catalog.
 *
 * null is a live request still settling, [] is an authoritative successful
 * response with no entitlements, and absence means discovery is unavailable
 * or failed so catalog consumers may use their documented seed fallback.
 */
export const readyProviderModelsAtom = Atom.family((catalog: ModelCatalog | undefined) =>
  Atom.make((get): Map<BackendKind, ProviderModel[] | null> => {
    const status = valueOf(get(managedHostStatusAtom)) ?? null;
    const ready = readyProviderModelRequests(catalog, status);
    const live = new Map<BackendKind, ProviderModel[] | null>();
    for (const request of ready) {
      const backend = managedProviderModelsKey(request);
      const result = get(managedProviderModelsAtom(backend));
      // Presence in the map means live discovery succeeded. An empty index is
      // authoritative too: falling back to the seed catalog would expose models
      // this organization is not entitled to use.
      if (AsyncResult.isInitial(result)) live.set(request.backend, null);
      else if (AsyncResult.isSuccess(result) && result.value) {
        live.set(request.backend, result.value.models);
      }
    }
    return live;
  }),
);
