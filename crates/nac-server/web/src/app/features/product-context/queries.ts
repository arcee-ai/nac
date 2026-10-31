import { useQuery } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";

export function useProductContext(sessionId: string | null, enabled: boolean) {
  const { api } = useNativeRuntime();
  const query = useQuery({
    queryKey: ["product-context", sessionId],
    queryFn: ({ signal }) => api.getProductContext(sessionId, signal),
    enabled,
    staleTime: 0,
    retry: false,
  });
  return { ...query, data: query.isError ? undefined : query.data };
}
