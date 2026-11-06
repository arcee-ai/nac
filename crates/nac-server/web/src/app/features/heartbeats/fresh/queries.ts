import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { secureRequestId } from "@/app/lib/requestId";
import { ApiError } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import type {
  FreshTaskDestination,
  FreshTaskScheduleControlRequest,
  FreshTaskRetainedAllowanceChange,
  HeartbeatAction,
  HeartbeatReceipt,
} from "@/app/types/api";

export const freshScheduleKey = (projectId: string) => ["fresh-task-schedules", projectId] as const;

export function useFreshRetainedAllowance(projectId: string, onSuccess: () => void) {
  const { api } = useNativeRuntime();
  const cache = useQueryClient();
  const [intent, setIntent] = useState<FreshTaskRetainedAllowanceChange | null>(null);
  const [identityError, setIdentityError] = useState<Error | null>(null);
  const control = useMutation({
    mutationFn: (request: FreshTaskRetainedAllowanceChange) =>
      api.changeFreshTaskRetainedAllowance(projectId, request),
    retry: false,
    onSuccess: () => {
      setIntent(null);
      onSuccess();
      void cache.invalidateQueries({ queryKey: ["fresh-task-schedules"] });
    },
  });
  const rejected =
    control.error instanceof ApiError && control.error.status >= 400 && control.error.status < 500;
  return {
    intent,
    control,
    rejected,
    error: identityError ?? control.error,
    submit: (expectedRevision: number, retainedLimit: number) => {
      if (intent || control.isPending) return;
      try {
        const request = {
          request_id: secureRequestId(),
          expected_revision: expectedRevision,
          retained_limit: retainedLimit,
        } satisfies FreshTaskRetainedAllowanceChange;
        setIdentityError(null);
        setIntent(request);
        control.mutate(request);
      } catch (error) {
        setIdentityError(
          error instanceof Error ? error : new Error("Could not create request identity."),
        );
      }
    },
    retry: () => {
      if (intent) control.mutate(intent);
    },
    reviewLatest: () => {
      if (!rejected) return;
      setIntent(null);
      control.reset();
      void cache.invalidateQueries({ queryKey: ["fresh-task-schedules"] });
      onSuccess();
    },
  };
}

export function useFreshTaskSchedules(projectId: string, scheduleId: string | null) {
  const { api } = useNativeRuntime();
  const cache = useQueryClient();
  const [intent, setIntent] = useState<FreshTaskScheduleControlRequest | null>(null);
  const [identityError, setIdentityError] = useState<Error | null>(null);
  const accepted = useRef<((receipt: HeartbeatReceipt) => void) | undefined>(undefined);
  const inventory = useQuery({
    queryKey: freshScheduleKey(projectId || "all"),
    queryFn: async ({ signal }) =>
      projectId
        ? api.freshTaskScheduleInventory(projectId, signal)
        : (await api.heartbeatInventory(undefined, signal)).filter(
            (schedule) => schedule.session_id == null && schedule.binding.fresh_task != null,
          ),
    retry: false,
    refetchInterval: 2000,
  });
  const inspection = useQuery({
    queryKey: [...freshScheduleKey(projectId), scheduleId],
    queryFn: ({ signal }) => api.freshTaskScheduleInspection(projectId, scheduleId!, signal),
    enabled: !!projectId && scheduleId !== null,
    retry: false,
    refetchInterval: 2000,
  });
  const control = useMutation({
    mutationFn: (request: FreshTaskScheduleControlRequest) =>
      api.controlFreshTaskSchedule(projectId, request),
    retry: false,
    onSuccess: (receipt) => {
      accepted.current?.(receipt);
      accepted.current = undefined;
      setIntent(null);
      void cache.invalidateQueries({ queryKey: ["fresh-task-schedules"] });
      void cache.invalidateQueries({ queryKey: ["heartbeats"] });
      void cache.invalidateQueries({ queryKey: queryKeys.sessionsAll });
    },
  });
  return {
    inventory,
    inspection,
    control,
    intent,
    error: identityError ?? control.error,
    submit: (
      operation: HeartbeatAction,
      destination: FreshTaskDestination | null,
      onSuccess?: (receipt: HeartbeatReceipt) => void,
    ) => {
      if (intent || control.isPending) return;
      try {
        const request = {
          request_id: secureRequestId(),
          operation,
          destination,
          creator_session_id: null,
        } satisfies FreshTaskScheduleControlRequest;
        setIdentityError(null);
        setIntent(request);
        accepted.current = onSuccess;
        control.mutate(request);
      } catch (error) {
        setIdentityError(
          error instanceof Error ? error : new Error("Could not create request identity."),
        );
      }
    },
    retry: () => {
      if (intent) control.mutate(intent);
    },
    rejected:
      control.error instanceof ApiError &&
      control.error.status >= 400 &&
      control.error.status < 500,
    reviewLatest: () => {
      if (
        !(control.error instanceof ApiError) ||
        control.error.status < 400 ||
        control.error.status >= 500
      )
        return;
      setIntent(null);
      accepted.current = undefined;
      control.reset();
      void cache.invalidateQueries({ queryKey: freshScheduleKey(projectId) });
    },
  };
}

export function useFreshInitialInput(
  sessionId: string,
  inputId: number | null | undefined,
  present: boolean | undefined,
  settled = false,
) {
  const { api } = useNativeRuntime();
  return useQuery({
    queryKey: ["fresh-task-initial-input", sessionId, inputId, settled],
    queryFn: async ({ signal }) =>
      (await api.listInbox(sessionId, signal)).find((item) => item.id === inputId) ?? null,
    enabled: present === true && inputId != null,
    retry: false,
    staleTime: settled ? Infinity : 0,
    refetchOnWindowFocus: !settled,
    refetchInterval: (query) =>
      settled ||
      query.state.data?.status === "delivered" ||
      query.state.data?.status === "cancelled"
        ? false
        : 1000,
  });
}
