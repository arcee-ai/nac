import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { ApiError } from "@/app/services/api";
import type { HeartbeatReceipt, HeartbeatInspection } from "@/app/types/api";
import { secureRequestId } from "@/app/lib/requestId";
import { queryKeys } from "@/app/services/queries/keys";
import type { HeartbeatAction, HeartbeatControlRequest } from "@/app/types/api";

export const heartbeatKey = (sessionId: string) => ["heartbeats", sessionId] as const;

export function useHeartbeats(sessionId: string, scheduleId: string | null, allChats = false) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  const accepted = useRef<((receipt: HeartbeatReceipt) => void) | undefined>(undefined);
  const [intent, setIntent] = useState<HeartbeatControlRequest | null>(null);
  const [identityError, setIdentityError] = useState<Error | null>(null);
  const inventory = useQuery({
    queryKey: heartbeatKey(allChats ? "all" : sessionId),
    queryFn: ({ signal }) => api.heartbeatInventory(allChats ? undefined : sessionId, signal),
    refetchInterval: 2000,
    retry: false,
  });
  const inspection = useQuery({
    queryKey: [...heartbeatKey(sessionId), scheduleId],
    queryFn: ({ signal }) => api.heartbeatInspection(sessionId, scheduleId!, signal),
    enabled: scheduleId !== null,
    refetchInterval: 2000,
    retry: false,
  });
  const control = useMutation({
    mutationFn: (request: HeartbeatControlRequest) => api.controlHeartbeat(sessionId, request),
    retry: false,
    onSuccess: (receipt) => {
      client.setQueryData<HeartbeatInspection>(
        [...heartbeatKey(sessionId), receipt.schedule.schedule_id],
        (current) => {
          // A replay returns the original receipt. Keep any already-read
          // state at that version, including suspension before a run starts.
          const newer = current && current.schedule.version >= receipt.schedule.version;
          return {
            schedule: newer ? current.schedule : receipt.schedule,
            history:
              current?.history ??
              [receipt.active_occurrence, receipt.occurrence].filter((item) => item != null),
          };
        },
      );
      accepted.current?.(receipt);
      accepted.current = undefined;
      setIntent(null);
      void client.invalidateQueries({ queryKey: ["heartbeats"] });
      void client.invalidateQueries({ queryKey: queryKeys.sessionsAll });
    },
  });
  return {
    inventory,
    inspection,
    control,
    intent,
    error: identityError ?? control.error,
    submit: (operation: HeartbeatAction, onSuccess?: (receipt: HeartbeatReceipt) => void) => {
      if (intent || control.isPending) return;
      try {
        const request = { request_id: secureRequestId(), operation };
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
    dismissRejection: () => {
      if (
        control.error instanceof ApiError &&
        control.error.status >= 400 &&
        control.error.status < 500
      ) {
        setIntent(null);
        control.reset();
        void client.invalidateQueries({ queryKey: ["heartbeats"] });
      }
    },
    rejected:
      control.error instanceof ApiError &&
      control.error.status >= 400 &&
      control.error.status < 500,
    retry: () => {
      if (intent) control.mutate(intent);
    },
  };
}
