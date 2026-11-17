import { secureRequestId } from "@/app/lib/requestId";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "@/app/services/queries/keys";
import type { TaskLaunchRequest } from "@/app/types/api";

/**
 * Whether a project can start an isolated task (a committed Local Git source),
 * and its saved default branch. Only asked for while it can matter.
 */
export function useTaskLaunchSource(projectId: string | null, enabled: boolean) {
  const { api } = useNativeRuntime();
  return useQuery({
    queryKey: ["task-launch-source", projectId],
    queryFn: ({ signal }) => api.taskLaunchSource(projectId ?? "", signal),
    enabled: enabled && projectId != null,
    staleTime: 30_000,
    retry: false,
  });
}

export function useTaskLaunch(projectId: string) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  const [intent, setIntent] = useState<TaskLaunchRequest | null>(null);
  const [identityError, setIdentityError] = useState<Error | null>(null);
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
    error: identityError ?? start.error,
    launch: (request: Omit<TaskLaunchRequest, "request_id">) => {
      try {
        const canonical = intent ?? { ...request, request_id: secureRequestId() };
        setIdentityError(null);
        setIntent(canonical);
        start.mutate(canonical);
      } catch (error) {
        setIdentityError(
          error instanceof Error ? error : new Error("Could not securely create a task request."),
        );
      }
    },
    retry: (request: TaskLaunchRequest) => {
      setIdentityError(null);
      setIntent(request);
      start.mutate(request);
    },
    newRequest: () => {
      setIdentityError(null);
      setIntent(null);
      start.reset();
    },
  };
}
