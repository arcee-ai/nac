import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "@/app/services/queries/keys";
import type { TaskLaunchRequest } from "@/app/types/api";

export function useTaskLaunch(projectId: string) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  const [intent, setIntent] = useState<TaskLaunchRequest | null>(null);
  const inventory = useQuery({
    queryKey: ["task-launches", projectId],
    queryFn: ({ signal }) => api.taskLaunchInventory(projectId, signal),
    refetchInterval: 2000,
  });
  const start = useMutation({
    mutationFn: (request: TaskLaunchRequest) => api.startTaskLaunch(request),
    retry: false,
    onSuccess: () => client.invalidateQueries({ queryKey: ["task-launches", projectId] }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelTaskLaunch(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ["task-launches", projectId] }),
  });
  const receipt = inventory.data?.find(
    (record) => record.request.request_id === intent?.request_id,
  );
  useEffect(() => {
    if (receipt?.first_input_id != null) {
      void client.invalidateQueries({ queryKey: queryKeys.sessionsAll });
    }
  }, [client, receipt?.first_input_id]);
  return {
    inventory,
    start,
    cancel,
    receipt,
    intent,
    launch: (request: Omit<TaskLaunchRequest, "request_id">) => {
      const canonical = intent ?? { ...request, request_id: crypto.randomUUID() };
      setIntent(canonical);
      start.mutate(canonical);
    },
    retry: (request: TaskLaunchRequest) => {
      setIntent(request);
      start.mutate(request);
    },
    newRequest: () => {
      setIntent(null);
      start.reset();
    },
  };
}
