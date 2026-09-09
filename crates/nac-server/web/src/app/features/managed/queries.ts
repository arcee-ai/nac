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
  ManagedUpgradeBlocker,
  ManagedUpgradeOperation,
  ManagedUpgradeSnapshot,
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
  return useQuery<ManagedHostStatus>({
    queryKey: managedQueryKeys.hostStatus,
    queryFn: ({ signal }) => api.getManagedStatus(signal),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
  });
}

const terminalUpgradeStates = new Set(["succeeded", "failed"]);

export function useManagedUpgrade(enabled = true) {
  return useQuery<ManagedUpgradeSnapshot>({
    queryKey: managedQueryKeys.upgrade,
    queryFn: ({ signal }) => api.getManagedUpgrade(signal),
    enabled,
    retry: false,
    refetchInterval: (query) => {
      const operation = query.state.data?.operation;
      return operation && !terminalUpgradeStates.has(operation.state) ? 1_000 : false;
    },
  });
}

export function useStartManagedUpgrade() {
  const client = useQueryClient();
  return useMutation<ManagedUpgradeOperation, Error, string>({
    mutationFn: (idempotencyKey) => api.startManagedUpgrade(idempotencyKey),
    onSuccess: (operation) => {
      client.setQueryData<ManagedUpgradeSnapshot>(managedQueryKeys.upgrade, (snapshot) =>
        snapshot ? { ...snapshot, operation } : snapshot,
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: managedQueryKeys.upgrade }),
  });
}

export async function settleManagedUpgradeBlocker(blocker: ManagedUpgradeBlocker): Promise<void> {
  const target = blocker.target;
  if (!blocker.actionable || target == null) return;
  switch (blocker.action) {
    case "cancel_active_run":
      if (target.session_id == null) throw new Error("Active run blocker has no session");
      return api.cancelActiveRun(target.session_id);
    case "cancel_traditional_child":
      if (target.session_id == null || target.child_session_id == null) {
        throw new Error("Child blocker is incomplete");
      }
      await api.cancelTraditionalChild(target.session_id, target.child_session_id);
      return;
    case "cancel_managed_orchestrator":
      if (target.session_id == null || target.orchestrator_session_id == null) {
        throw new Error("Orchestrator blocker is incomplete");
      }
      await api.cancelManagedOrchestrator(target.session_id, target.orchestrator_session_id);
      return;
    case "terminate_terminal":
      if (target.session_id == null || target.terminal_id == null) {
        throw new Error("Terminal blocker is incomplete");
      }
      return api.terminateTerminal(target.session_id, target.terminal_id);
    case "cancel_clone_operation":
      if (target.clone_operation_id == null) throw new Error("Clone blocker has no operation");
      await api.cancelManagedClone(target.clone_operation_id);
      return;
    case "wait":
      return;
  }
}

export function useSettleManagedUpgradeBlockers() {
  const client = useQueryClient();
  return useMutation<void, Error, ManagedUpgradeBlocker[]>({
    mutationFn: async (blockers) => {
      const results = await Promise.allSettled(blockers.map(settleManagedUpgradeBlocker));
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length > 0) throw new AggregateError(failures, "Some work could not be stopped");
    },
    onSettled: () => client.invalidateQueries({ queryKey: managedQueryKeys.upgrade }),
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
