import { useQuery } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";

/** Public wire projections share the native runtime's cache and cancellation lifetime. */
export const publicNativeKeys = {
  uiConfiguration: ["public-native-v1", "ui-configuration"] as const,
  catalog: ["public-native-v1", "model-catalog"] as const,
  modelConfigs: ["public-native-v1", "model-configs"] as const,
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

export function usePublicSessionConfig(id: string | null) {
  const { publicPresentation: api } = useNativeRuntime();
  return useQuery({
    queryKey: publicNativeKeys.sessionConfig(id ?? ""),
    queryFn: ({ signal }) => api!.getSessionConfig(id!, signal),
    enabled: Boolean(api && id),
    retry: false,
  });
}
