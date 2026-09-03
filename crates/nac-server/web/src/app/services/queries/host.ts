import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import type {
  ManagedAuthProvider,
  SandboxActivity,
  SandboxAvailability,
  StoredCredentialList,
  StoreInfo,
} from "@/app/types/api";

export function useStoreInfo() {
  return useQuery<StoreInfo>({
    queryKey: queryKeys.storeInfo,
    queryFn: ({ signal }) => api.getStore(signal),
    staleTime: Infinity,
  });
}

/**
 * Whether this host can run sandboxed sessions. Probing spawns podman
 * subprocesses, so it runs only while a caller asks for it — today that is
 * the launch form with sandbox mode selected.
 */
export function useSandboxAvailability(enabled: boolean) {
  return useQuery<SandboxAvailability>({
    queryKey: queryKeys.sandboxAvailability,
    queryFn: ({ signal }) => api.getSandboxAvailability(signal),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Sandbox setup in progress for one launch (image pull, container start),
 * polled while the launch request is in flight so a minutes-long first pull
 * shows movement instead of a frozen button. Keyed by the launch id sent
 * with the create request, so concurrent launches stay independent.
 */
export function useSandboxActivity(enabled: boolean, key: string | null) {
  return useQuery<SandboxActivity | null>({
    queryKey: [...queryKeys.sandboxActivity, key],
    queryFn: ({ signal }) => api.getSandboxActivity(key as string, signal),
    enabled: enabled && key !== null,
    staleTime: 0,
    refetchInterval: 1000,
    retry: false,
  });
}

/**
 * Which API key names have a value stored in NAC home. Used to tell the user
 * whether a session can authenticate without the environment variable being
 * set; failures are non-fatal because the environment may well supply the key.
 */
export function useStoredCredentials(enabled = true) {
  return useQuery<StoredCredentialList>({
    queryKey: queryKeys.credentials,
    queryFn: ({ signal }) => api.listCredentials(signal),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useStoreCredential() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      api.storeCredential(name, value),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.credentials }),
  });
}

/**
 * Files a key away and reports the name it was given. Used where the key is the
 * thing the user supplies and the selector is an implementation detail.
 */
export function useStoreGeneratedCredential() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (value: string) => api.storeGeneratedCredential(value),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.credentials }),
  });
}

export function useDeleteCredential() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteCredential(name),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.credentials }),
  });
}

/**
 * Whether the providers that sign in through a browser are signed in. Reported
 * per provider rather than per configuration, because the credential is one
 * file in NAC home that every session using that backend shares.
 */
export function useManagedLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (provider: ManagedAuthProvider) => api.managedLogout(provider),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.managedAuth });
      // The model index was only readable through the login that just went
      // away, so what is cached from it is no longer true — including the copy a
      // resolved configuration carries.
      client.removeQueries({ queryKey: queryKeys.managedProviderModelsAll });
      await client.invalidateQueries({
        queryKey: queryKeys.resolvedModelConfigsAll,
      });
      await client.invalidateQueries({
        queryKey: queryKeys.resolvedConfigFilesAll,
      });
    },
  });
}
