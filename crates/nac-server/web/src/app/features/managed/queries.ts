// Managed-host server state. These keys remain byte-for-byte compatible with
// the historical shared query module so polling, invalidation and cache resume
// behavior survive the feature extraction.

import { useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

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
  providerModels: (backend: string) => ["managed-provider-models", backend] as const,
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

export function useManagedProviderModels(backend: BackendKind | null, enabled: boolean) {
  return useQuery<ProviderModelList>({
    queryKey: managedQueryKeys.providerModels(backend ?? ""),
    queryFn: () => api.listProviderModels({ backend: backend! }),
    enabled: enabled && backend !== null,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useReadyManagedProviderModels(catalog: ModelCatalog | undefined) {
  const ready = useMemo(
    () =>
      (catalog?.providers ?? []).filter(
        (provider) => provider.auth_status === "ready" && provider.auth !== "api_key_env",
      ),
    [catalog],
  );
  const results = useQueries({
    queries: ready.map((provider) => ({
      queryKey: managedQueryKeys.providerModels(provider.id),
      queryFn: () => api.listProviderModels({ backend: provider.id }),
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });
  const live = new Map<BackendKind, ProviderModel[]>();
  ready.forEach((provider, index) => {
    const models = results[index]?.data?.models;
    if (models?.length) live.set(provider.id, models);
  });
  return live;
}
