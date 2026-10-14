import { useQuery } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { PublicNacSessionListOptions } from "../../../../packages/nac-client/src/publicNacApi.js";

/** Public wire projections share the native runtime's cache and cancellation lifetime. */
export const publicNativeKeys = {
  uiConfiguration: ["public-native-v1", "ui-configuration"] as const,
  catalog: ["public-native-v1", "model-catalog"] as const,
  modelConfigs: ["public-native-v1", "model-configs"] as const,
  projects: ["public-native-v1", "projects"] as const,
  sessions: (options: PublicNacSessionListOptions) =>
    ["public-native-v1", "sessions", options] as const,
  sessionConfig: (id: string) => ["public-native-v1", "session", id, "config"] as const,
};

export function usePublicModelCatalog() {
  const { publicPresentation: api } = useNativeRuntime();
  return useQuery({
    queryKey: publicNativeKeys.catalog,
    queryFn: ({ signal }) => api!.getModelCatalog(signal),
    enabled: Boolean(api),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function usePublicModelConfigs() {
  const { publicPresentation: api } = useNativeRuntime();
  return useQuery({
    queryKey: publicNativeKeys.modelConfigs,
    queryFn: ({ signal }) => api!.listModelConfigs(signal),
    enabled: Boolean(api),
    staleTime: 30_000,
    retry: false,
  });
}

export function usePublicProjects() {
  const { publicPresentation: api } = useNativeRuntime();
  return useQuery({
    queryKey: publicNativeKeys.projects,
    queryFn: ({ signal }) => api!.listProjects(signal),
    enabled: Boolean(api),
    staleTime: 30_000,
    retry: false,
  });
}

export function usePublicSessions(options: PublicNacSessionListOptions = {}) {
  const { publicPresentation: api } = useNativeRuntime();
  return useQuery({
    queryKey: publicNativeKeys.sessions(options),
    queryFn: ({ signal }) => api!.listSessions(options, signal),
    enabled: Boolean(api),
    staleTime: 0,
    refetchInterval: 5000,
    retry: false,
  });
}

export function usePublicSessionConfig(id: string | null) {
  const { publicPresentation: api } = useNativeRuntime();
  return useQuery({
    queryKey: publicNativeKeys.sessionConfig(id ?? ""),
    queryFn: ({ signal }) => api!.getSessionConfig(id!, signal),
    enabled: Boolean(api && id),
    retry: false,
  });
}
