// Managed-host server state. These keys remain byte-for-byte compatible with
// the historical shared query module so polling, invalidation and cache resume
// behavior survive the feature extraction.

import { useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { readyManagedModelRequests } from "@/app/features/managed/model";
import { api } from "@/app/services/api";
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
  providerModels: (backend: string, baseUrl?: string | null) =>
    baseUrl
      ? (["managed-provider-models", backend, baseUrl] as const)
      : (["managed-provider-models", backend] as const),
  providerModelsAll: ["managed-provider-models"] as const,
};

export function useManagedHostStatus() {
  return useQuery<ManagedHostStatus>({
    queryKey: managedQueryKeys.hostStatus,
    queryFn: ({ signal }) => api.getManagedStatus(signal),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
  });
}

export function useManagedGitHub(enabled = true) {
  return useQuery<ManagedGitHubStatus>({
    queryKey: managedQueryKeys.github,
    queryFn: ({ signal }) => api.getManagedGitHub(signal),
    enabled,
    retry: false,
  });
}

export function useManagedSecrets(enabled = true) {
  return useQuery<ManagedSecretList>({
    queryKey: managedQueryKeys.secrets,
    queryFn: ({ signal }) => api.listManagedSecrets(signal),
    enabled,
    retry: false,
  });
}

export function usePutManagedSecret() {
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

export function useManagedAuth(enabled = true) {
  return useQuery<ManagedAuthList>({
    queryKey: managedQueryKeys.auth,
    queryFn: ({ signal }) => api.listManagedAuth(signal),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useManagedProviderModels(
  backend: BackendKind | null,
  enabled: boolean,
  baseUrl: string | null = null,
) {
  return useQuery<ProviderModelList>({
    queryKey: managedQueryKeys.providerModels(backend ?? "", baseUrl),
    queryFn: () =>
      api.listProviderModels(
        baseUrl ? { backend: backend!, base_url: baseUrl } : { backend: backend! },
      ),
    enabled: enabled && backend !== null,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useReadyManagedProviderModels(catalog: ModelCatalog | undefined) {
  const status = useManagedHostStatus().data ?? null;
  const ready = useMemo(() => readyManagedModelRequests(catalog, status), [catalog, status]);
  const results = useQueries({
    queries: ready.map((request) => ({
      queryKey: managedQueryKeys.providerModels(request.backend, request.base_url),
      queryFn: () => api.listProviderModels(request),
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
