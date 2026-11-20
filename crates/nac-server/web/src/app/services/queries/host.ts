import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  authenticationCommand,
  runAuthentication,
} from "@/app/features/managed/controller/authenticationWorkflow";

import {
  refreshProviderAuthentication,
  refreshUnifiedProviderCatalog,
} from "@/app/services/queries/configuration";
import { queryKeys } from "@/app/services/queries/keys";
import type { ManagedAuthProvider, StoredCredentialList, StoreInfo } from "@/app/types/api";

export function useStoreInfo() {
  const { api } = useNativeRuntime();

  return useQuery<StoreInfo>({
    queryKey: queryKeys.storeInfo,
    queryFn: ({ signal }) => api.getStore(signal),
    staleTime: Infinity,
  });
}

/**
 * Which API key names have a value stored in NAC home. Used to tell the user
 * whether a session can authenticate without the environment variable being
 * set; failures are non-fatal because the environment may well supply the key.
 */
export function useStoredCredentials(enabled = true) {
  const { api } = useNativeRuntime();

  return useQuery<StoredCredentialList>({
    queryKey: queryKeys.credentials,
    queryFn: ({ signal }) => api.listCredentials(signal),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useStoreCredential() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      api.storeCredential(name, value),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.credentials }),
        refreshUnifiedProviderCatalog(client),
      ]);
    },
  });
}

/**
 * Files a key away and reports the name it was given. Used where the key is the
 * thing the user supplies and the selector is an implementation detail.
 */
export function useStoreGeneratedCredential() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: (value: string) => api.storeGeneratedCredential(value),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.credentials }),
  });
}

export function useDeleteCredential() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteCredential(name),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.credentials }),
        refreshUnifiedProviderCatalog(client),
      ]);
    },
  });
}

/**
 * Whether the providers that sign in through a browser are signed in. Reported
 * per provider rather than per configuration, because the credential is one
 * file in NAC home that every session using that backend shares.
 */
export function useManagedLogout() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (provider: ManagedAuthProvider) =>
      runAuthentication(
        authenticationCommand({
          command: () => api.managedLogout(provider),
          reconcile: () => refreshProviderAuthentication(client),
        }),
      ),
  });
}
