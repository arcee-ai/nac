import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { NativeApi } from "@/app/services/api";

type RefreshTarget = {
  sessionId: string;
  revision: number;
  api: NativeApi;
  client: QueryClient;
};

export function useSessionIntegrations(sessionId: string, open: boolean) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  const key = ["session-integrations", sessionId];
  const status = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.sessionIntegrations(sessionId, signal),
    enabled: open,
    refetchInterval: (query) =>
      open && query.state.data?.state === "pending" && query.state.data.revision > 0 ? 1500 : false,
  });
  const refresh = useMutation({
    mutationFn: ({ api, sessionId, revision }: RefreshTarget) =>
      api.refreshSessionIntegrations(sessionId, revision),
    retry: false,
    onSuccess: (next, target) =>
      target.client.setQueryData(["session-integrations", target.sessionId], next),
    onSettled: (_next, _error, target) =>
      target.client.invalidateQueries({ queryKey: ["session-integrations", target.sessionId] }),
  });
  return {
    status,
    refresh,
    requestRefresh: (revision: number) => refresh.mutate({ sessionId, revision, api, client }),
  };
}
