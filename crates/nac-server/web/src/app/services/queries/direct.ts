import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/app/services/queries/keys";
import type {
  CreateGoalRequest,
  InboxDelivery,
  InboxItem,
  ManagedOrchestratorRecord,
  PermissionApprovalMode,
  PermissionReply,
  PermissionStateResponse,
  SessionGoalRecord,
  StartManagedOrchestratorRequest,
  StartTraditionalChildRequest,
  TraditionalChildRecord,
  UpdateGoalRequest,
} from "@/app/types/api";

/** Foreground responses can settle after a newer run or cancellation was polled. */
function acceptSubagentRecord<T extends { generation: number; version: number }>(
  records: T[],
  incoming: T,
  id: (record: T) => string,
): T[] {
  const current = records.find((record) => id(record) === id(incoming));
  if (current && (current.generation > incoming.generation || current.version > incoming.version))
    return records;
  return current
    ? records.map((record) => (id(record) === id(incoming) ? incoming : record))
    : [...records, incoming];
}

/** List membership is authoritative; an older in-flight poll cannot rewind a known record. */
function acceptSubagentList<T extends { generation: number; version: number }>(
  previous: T[] | undefined,
  incoming: T[],
  id: (record: T) => string,
): T[] {
  return incoming.map((record) => {
    const current = previous?.find((candidate) => id(candidate) === id(record));
    return current && (current.generation > record.generation || current.version > record.version)
      ? current
      : record;
  });
}

export function useSessionPermissions(sessionId: string, enabled: boolean, poll = true) {
  const { api } = useNativeRuntime();

  return useQuery<PermissionStateResponse>({
    queryKey: queryKeys.sessionPermissions(sessionId),
    queryFn: ({ signal }) => api.getPermissions(sessionId, signal),
    enabled,
    refetchInterval: enabled && poll ? 1_000 : false,
    staleTime: 0,
    retry: false,
  });
}

export function useReplyPermission() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      requestId,
      reply,
    }: {
      sessionId: string;
      requestId: string;
      reply: PermissionReply;
    }) => api.replyPermission(sessionId, requestId, reply),
    onSuccess: (_data, variables) =>
      client.invalidateQueries({ queryKey: queryKeys.sessionPermissions(variables.sessionId) }),
  });
}

/** Authorizes one retry of a blocked review. The model is asked to retry and
 * the retry passes policy and a fresh review; nothing is bypassed. */
export function useAuthorizePermissionReviewRetry() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      reviewId,
      parentSessionId,
    }: {
      sessionId: string;
      reviewId: string;
      parentSessionId?: string;
    }) =>
      parentSessionId
        ? api.authorizeChildPermissionReviewRetry(parentSessionId, sessionId, reviewId)
        : api.authorizePermissionReviewRetry(sessionId, reviewId),
    onSuccess: (_data, variables) =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.sessionPermissions(variables.sessionId) }),
        ...(variables.parentSessionId
          ? [
              client.invalidateQueries({
                queryKey: queryKeys.traditionalChildren(variables.parentSessionId),
              }),
            ]
          : []),
      ]),
  });
}

export function useSetPermissionApprovalMode() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, mode }: { sessionId: string; mode: PermissionApprovalMode }) =>
      api.setPermissionApprovalMode(sessionId, mode),
    onSuccess: (_data, variables) => {
      client.setQueryData<PermissionStateResponse>(
        queryKeys.sessionPermissions(variables.sessionId),
        (current) =>
          current
            ? {
                ...current,
                approval_mode: variables.mode,
                requests: variables.mode === "auto_approve" ? [] : current.requests,
              }
            : current,
      );
    },
  });
}

export function useDeletePermissionGrant() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, grantId }: { sessionId: string; grantId: string }) =>
      api.deletePermissionGrant(sessionId, grantId),
    onSuccess: (_data, variables) =>
      client.invalidateQueries({ queryKey: queryKeys.sessionPermissions(variables.sessionId) }),
  });
}

export function useSessionGoal(sessionId: string, enabled: boolean) {
  const { api } = useNativeRuntime();

  return useQuery<SessionGoalRecord | null>({
    queryKey: queryKeys.sessionGoal(sessionId),
    queryFn: ({ signal }) => api.getGoal(sessionId, signal),
    enabled,
    refetchInterval: enabled ? 1_000 : false,
    retry: false,
  });
}

export function useCreateGoal() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, payload }: { sessionId: string; payload: CreateGoalRequest }) =>
      api.createGoal(sessionId, payload),
    onSuccess: (goal, variables) =>
      client.setQueryData(queryKeys.sessionGoal(variables.sessionId), goal),
  });
}

export function useUpdateGoal() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      goalId,
      payload,
    }: {
      sessionId: string;
      goalId: string;
      payload: UpdateGoalRequest;
    }) => api.updateGoal(sessionId, goalId, payload),
    onSuccess: (goal, variables) =>
      client.setQueryData(queryKeys.sessionGoal(variables.sessionId), goal),
  });
}

export function useClearGoal() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      goalId,
      expectedVersion,
    }: {
      sessionId: string;
      goalId: string;
      expectedVersion: number;
    }) => api.clearGoal(sessionId, goalId, expectedVersion),
    onSuccess: (_data, variables) =>
      client.setQueryData(queryKeys.sessionGoal(variables.sessionId), null),
  });
}

export function useTraditionalChildren(sessionId: string, enabled: boolean) {
  const { api } = useNativeRuntime();

  return useQuery<TraditionalChildRecord[]>({
    queryKey: queryKeys.traditionalChildren(sessionId),
    queryFn: ({ signal }) => api.listTraditionalChildren(sessionId, signal),
    enabled,
    refetchInterval: enabled ? 1_000 : false,
    retry: false,
    structuralSharing: (previous, incoming) =>
      acceptSubagentList(
        previous as TraditionalChildRecord[] | undefined,
        incoming as TraditionalChildRecord[],
        (record) => record.child_session_id,
      ),
  });
}

export function useStartTraditionalChild() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      payload,
    }: {
      sessionId: string;
      payload: StartTraditionalChildRequest;
    }) => api.startTraditionalChild(sessionId, payload),
    onSuccess: (child, variables) => {
      client.setQueryData<TraditionalChildRecord[]>(
        queryKeys.traditionalChildren(variables.sessionId),
        (children = []) =>
          acceptSubagentRecord(children, child, (record) => record.child_session_id),
      );
    },
  });
}

export function useCancelTraditionalChild() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, childId }: { sessionId: string; childId: string }) =>
      api.cancelTraditionalChild(sessionId, childId),
    onSuccess: (child, variables) => {
      client.setQueryData<TraditionalChildRecord[]>(
        queryKeys.traditionalChildren(variables.sessionId),
        (children = []) =>
          acceptSubagentRecord(children, child, (record) => record.child_session_id),
      );
    },
  });
}

export function useManagedOrchestrators(sessionId: string, enabled: boolean) {
  const { api } = useNativeRuntime();

  const policy = useUiPolicy();
  enabled = enabled && policy.orchestrationEnabled;
  return useQuery<ManagedOrchestratorRecord[]>({
    queryKey: queryKeys.managedOrchestrators(sessionId),
    queryFn: ({ signal }) => api.listManagedOrchestrators(sessionId, signal),
    enabled,
    refetchInterval: enabled ? 1_000 : false,
    retry: false,
    structuralSharing: (previous, incoming) =>
      acceptSubagentList(
        previous as ManagedOrchestratorRecord[] | undefined,
        incoming as ManagedOrchestratorRecord[],
        (record) => record.orchestrator_session_id,
      ),
  });
}

export function useStartManagedOrchestrator() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      payload,
    }: {
      sessionId: string;
      payload: StartManagedOrchestratorRequest;
    }) => api.startManagedOrchestrator(sessionId, payload),
    onSuccess: (orchestrator, variables) => {
      client.setQueryData<ManagedOrchestratorRecord[]>(
        queryKeys.managedOrchestrators(variables.sessionId),
        (orchestrators = []) =>
          acceptSubagentRecord(
            orchestrators,
            orchestrator,
            (record) => record.orchestrator_session_id,
          ),
      );
    },
  });
}

export function useCancelManagedOrchestrator() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, orchestratorId }: { sessionId: string; orchestratorId: string }) =>
      api.cancelManagedOrchestrator(sessionId, orchestratorId),
    onSuccess: (orchestrator, variables) => {
      client.setQueryData<ManagedOrchestratorRecord[]>(
        queryKeys.managedOrchestrators(variables.sessionId),
        (orchestrators = []) =>
          acceptSubagentRecord(
            orchestrators,
            orchestrator,
            (record) => record.orchestrator_session_id,
          ),
      );
    },
  });
}

export function useSessionInbox(sessionId: string, enabled: boolean) {
  const { api } = useNativeRuntime();

  return useQuery<InboxItem[]>({
    queryKey: queryKeys.sessionInbox(sessionId),
    queryFn: ({ signal }) => api.listInbox(sessionId, signal),
    enabled,
    refetchInterval: enabled ? 1000 : false,
    retry: false,
  });
}

export function useCreateInboxItem() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      delivery,
      prompt,
    }: {
      sessionId: string;
      delivery: InboxDelivery;
      prompt: string;
    }) => api.createInboxItem(sessionId, delivery, prompt),
    onSuccess: (item, { sessionId }) => {
      client.setQueryData<InboxItem[]>(queryKeys.sessionInbox(sessionId), (items = []) => [
        ...items.filter((candidate) => candidate.id !== item.id),
        item,
      ]);
    },
  });
}

export function useUpdateInboxItem() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      itemId,
      expectedVersion,
      delivery,
    }: {
      sessionId: string;
      itemId: number;
      expectedVersion: number;
      delivery: InboxDelivery;
    }) => api.updateInboxItem(sessionId, itemId, expectedVersion, delivery),
    onSuccess: (item, { sessionId }) => {
      client.setQueryData<InboxItem[]>(queryKeys.sessionInbox(sessionId), (items = []) =>
        items.map((candidate) => (candidate.id === item.id ? item : candidate)),
      );
    },
  });
}

export function useCancelInboxItem() {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      itemId,
      expectedVersion,
    }: {
      sessionId: string;
      itemId: number;
      expectedVersion: number;
    }) => api.cancelInboxItem(sessionId, itemId, expectedVersion),
    onSuccess: (item, { sessionId }) => {
      client.setQueryData<InboxItem[]>(queryKeys.sessionInbox(sessionId), (items = []) =>
        items.map((candidate) => (candidate.id === item.id ? item : candidate)),
      );
    },
  });
}
