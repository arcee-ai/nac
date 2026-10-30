import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "@/app/services/queries/keys";
import type { TaskLaunchRequest } from "@/app/types/api";

function taskRequestId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== "function") {
    throw new Error(
      "This browser cannot securely create a task request. Use a browser with Web Crypto support.",
    );
  }
  // getRandomValues is available on standalone HTTP too. Keep a canonical v4
  // UUID so the server can validate the same durable identity on every retry.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
        const canonical = intent ?? { ...request, request_id: taskRequestId() };
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
