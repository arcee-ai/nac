import { useQuery } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";

export function useProductContext(sessionId: string | null, enabled: boolean) {
  const { api } = useNativeRuntime();
  return useQuery({
    queryKey: ["product-context", sessionId],
    queryFn: ({ signal }) => api.getProductContext(sessionId, signal),
    enabled,
    staleTime: 0,
    retry: false,
  });
}
