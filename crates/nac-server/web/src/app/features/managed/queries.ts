import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "@/app/services/queries/keys";
import { useModelCatalog } from "@/app/services/queries/configuration";
// Managed-host server state. These keys remain byte-for-byte compatible with
// the historical shared query module so polling, invalidation and cache resume
// behavior survive the feature extraction.

import { useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { readyProviderModelRequests } from "@/app/features/managed/model";
import {
  managedUpgradeIsActive,
  type ManagedUpgradeSnapshot,
} from "@/app/features/managed/upgrade";
import {
  decodeManagedUpgradeOperation,
  decodeManagedUpgradeSnapshot,
} from "@/app/features/managed/upgradeContract";

import type {
  BackendKind,
  ManagedAuthList,
  ManagedGitHubStatus,
  ManagedHostStatus,
  ManagedSecretList,
  ModelCatalog,
  ProviderModel,
  ProviderModelList,
} from "@/app/types/api";

export const managedQueryKeys = {
  hostStatus: ["managed-host-status"] as const,
  github: ["managed-github"] as const,
  secrets: ["managed-secrets"] as const,
  auth: ["managed-auth"] as const,
  upgrade: ["managed-upgrade"] as const,
  providerModels: (backend: string, baseUrl?: string | null) =>
    baseUrl
      ? (["managed-provider-models", backend, baseUrl] as const)
      : (["managed-provider-models", backend] as const),
  providerModelsAll: ["managed-provider-models"] as const,
};

export function useManagedHostStatus() {
  const { api } = useNativeRuntime();

  return useQuery<ManagedHostStatus>({
    queryKey: managedQueryKeys.hostStatus,
    queryFn: ({ signal }) => api.getManagedStatus(signal),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
  });
}

export function useManagedUpgradeSnapshot(enabled = true) {
  const { api } = useNativeRuntime();

  return useQuery<ManagedUpgradeSnapshot>({
    queryKey: managedQueryKeys.upgrade,
    queryFn: async ({ signal }) =>
      decodeManagedUpgradeSnapshot(await api.getManagedUpgrade(signal)),
    enabled,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.operation && managedUpgradeIsActive(query.state.data.operation.state)
        ? 1_000
        : 15_000,
    refetchIntervalInBackground: true,
    retry: false,
  });
}

export function useStartManagedUpgrade() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: async (idempotencyKey: string) =>
      decodeManagedUpgradeOperation(await api.startManagedUpgrade(idempotencyKey)),
    onSuccess: (operation) => {
      client.setQueryData<ManagedUpgradeSnapshot>(managedQueryKeys.upgrade, (snapshot) =>
        snapshot ? { ...snapshot, operation } : snapshot,
      );
      return client.invalidateQueries({ queryKey: managedQueryKeys.upgrade });
    },
  });
}

export function useManagedGitHub(enabled = true) {
  const { api } = useNativeRuntime();

  return useQuery<ManagedGitHubStatus>({
    queryKey: managedQueryKeys.github,
    queryFn: ({ signal }) => api.getManagedGitHub(signal),
    enabled,
    retry: false,
  });
}

export function useManagedSecrets(enabled = true) {
  const { api } = useNativeRuntime();

  return useQuery<ManagedSecretList>({
    queryKey: managedQueryKeys.secrets,
    queryFn: ({ signal }) => api.listManagedSecrets(signal),
    enabled,
    retry: false,
  });
}

export function usePutManagedSecret() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      api.putManagedSecret(name, value),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: managedQueryKeys.secrets }),
        client.invalidateQueries({ queryKey: managedQueryKeys.hostStatus }),
      ]),
  });
}

export function useDeleteManagedSecret() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteManagedSecret(name),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: managedQueryKeys.secrets }),
        client.invalidateQueries({ queryKey: managedQueryKeys.hostStatus }),
      ]),
  });
}

export function useManagedAuth(enabled = true, refetchInterval: number | false = false) {
  const { api } = useNativeRuntime();

  return useQuery<ManagedAuthList>({
    queryKey: managedQueryKeys.auth,
    queryFn: ({ signal }) => api.listManagedAuth(signal),
    enabled,
    staleTime: 30_000,
    refetchInterval,
    retry: false,
  });
}

/** Whether `credential` reaches the provider, probed afresh for each refused run. */
export function useProviderReachAfterRefusal(
  backend: BackendKind | null,
  refusal: string | null,
  credential: string | null,
) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  const catalog = useModelCatalog(
    backend === "chatgpt-codex-responses" && refusal !== null && credential !== null,
  );

  return useQuery<ProviderModelList>({
    queryKey: [
      ...managedQueryKeys.providerModels(backend ?? ""),
      "after-refusal",
      refusal,
      credential,
      ...(backend === "chatgpt-codex-responses" ? [catalog.data?.catalog_version] : []),
    ],
    queryFn: async ({ signal }) => {
      const result = await api.listProviderModels({ backend: backend! }, signal);
      if (backend === "chatgpt-codex-responses")
        await client.invalidateQueries({ queryKey: queryKeys.modelCatalog });
      return result;
    },
    enabled:
      backend !== null &&
      refusal !== null &&
      credential !== null &&
      (backend !== "chatgpt-codex-responses" || catalog.data !== undefined),
    retry: false,
    staleTime: Infinity,
  });
}

export function useManagedProviderModels(
  backend: BackendKind | null,
  enabled: boolean,
  baseUrl: string | null = null,
) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  const catalog = useModelCatalog(enabled && backend === "chatgpt-codex-responses");

  return useQuery<ProviderModelList>({
    queryKey:
      backend === "chatgpt-codex-responses"
        ? [
            ...managedQueryKeys.providerModels(backend, baseUrl),
            "catalog",
            catalog.data?.catalog_version,
          ]
        : managedQueryKeys.providerModels(backend ?? "", baseUrl),
    queryFn: async ({ signal }) => {
      const result = await api.listProviderModels(
        baseUrl ? { backend: backend!, base_url: baseUrl } : { backend: backend! },
        signal,
      );
      if (backend === "chatgpt-codex-responses")
        await client.invalidateQueries({ queryKey: queryKeys.modelCatalog });
      return result;
    },
    enabled:
      enabled &&
      backend !== null &&
      (backend !== "chatgpt-codex-responses" || catalog.data !== undefined),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useReadyProviderModels(catalog: ModelCatalog | undefined) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();

  const status = useManagedHostStatus().data ?? null;
  const ready = useMemo(() => readyProviderModelRequests(catalog, status), [catalog, status]);
  const results = useQueries({
    queries: ready.map((request) => ({
      queryKey:
        request.backend === "chatgpt-codex-responses"
          ? [
              ...managedQueryKeys.providerModels(request.backend, request.base_url),
              "catalog",
              catalog?.catalog_version,
            ]
          : [
              ...managedQueryKeys.providerModels(request.backend, request.base_url),
              request.api_key_env ?? null,
              request.allow_insecure_http ?? false,
            ],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const result = await api.listProviderModels(request, signal);
        if (request.backend === "chatgpt-codex-responses")
          await client.invalidateQueries({ queryKey: queryKeys.modelCatalog });
        return result;
      },
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });
  // null is a live request still settling, [] is an authoritative successful
  // response with no entitlements, and absence means discovery is unavailable
  // or failed so catalog consumers may use their documented seed fallback.
  const live = new Map<BackendKind, ProviderModel[] | null>();
  ready.forEach((request, index) => {
    const result = results[index];
    // Presence in the map means live discovery succeeded. An empty index is
    // authoritative too: falling back to the seed catalog would expose models
    // this organization is not entitled to use.
    if (result?.isPending) live.set(request.backend, null);
    else if (result?.isSuccess) live.set(request.backend, result.data.models);
  });
  return live;
}
