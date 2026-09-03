import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import type {
  CreateGoalRequest,
  InboxDelivery,
  InboxItem,
  ManagedOrchestratorRecord,
  PermissionReply,
  PermissionStateResponse,
  SessionAssignmentRecord,
  SessionGoalRecord,
  StartManagedOrchestratorRequest,
  StartSessionSpawnRequest,
  StartTraditionalChildRequest,
  TraditionalChildRecord,
  UpdateGoalRequest,
} from "@/app/types/api";

export function useSessionPermissions(sessionId: string, enabled: boolean) {
  return useQuery<PermissionStateResponse>({
    queryKey: queryKeys.sessionPermissions(sessionId),
    queryFn: ({ signal }) => api.getPermissions(sessionId, signal),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

export function useReplyPermission() {
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

export function useDeletePermissionGrant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, grantId }: { sessionId: string; grantId: string }) =>
      api.deletePermissionGrant(sessionId, grantId),
    onSuccess: (_data, variables) =>
      client.invalidateQueries({ queryKey: queryKeys.sessionPermissions(variables.sessionId) }),
  });
}

export function useSessionGoal(sessionId: string, enabled: boolean) {
  return useQuery<SessionGoalRecord | null>({
    queryKey: queryKeys.sessionGoal(sessionId),
    queryFn: ({ signal }) => api.getGoal(sessionId, signal),
    enabled,
    refetchInterval: enabled ? 1_000 : false,
    retry: false,
  });
}

export function useCreateGoal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, payload }: { sessionId: string; payload: CreateGoalRequest }) =>
      api.createGoal(sessionId, payload),
    onSuccess: (goal, variables) =>
      client.setQueryData(queryKeys.sessionGoal(variables.sessionId), goal),
  });
}

export function useUpdateGoal() {
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
  return useQuery<TraditionalChildRecord[]>({
    queryKey: queryKeys.traditionalChildren(sessionId),
    queryFn: ({ signal }) => api.listTraditionalChildren(sessionId, signal),
    enabled,
    refetchInterval: enabled ? 1_000 : false,
    retry: false,
  });
}

export function useStartTraditionalChild() {
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
        (children = []) => {
          const without = children.filter(
            (candidate) => candidate.child_session_id !== child.child_session_id,
          );
          return [...without, child];
        },
      );
    },
  });
}

export function useCancelTraditionalChild() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, childId }: { sessionId: string; childId: string }) =>
      api.cancelTraditionalChild(sessionId, childId),
    onSuccess: (child, variables) => {
      client.setQueryData<TraditionalChildRecord[]>(
        queryKeys.traditionalChildren(variables.sessionId),
        (children = []) =>
          children.map((candidate) =>
            candidate.child_session_id === child.child_session_id ? child : candidate,
          ),
      );
    },
  });
}

export function useManagedOrchestrators(sessionId: string, enabled: boolean) {
  return useQuery<ManagedOrchestratorRecord[]>({
    queryKey: queryKeys.managedOrchestrators(sessionId),
    queryFn: ({ signal }) => api.listManagedOrchestrators(sessionId, signal),
    enabled,
    refetchInterval: enabled ? 1_000 : false,
    retry: false,
  });
}

export function useStartManagedOrchestrator() {
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
        (orchestrators = []) => {
          const without = orchestrators.filter(
            (candidate) =>
              candidate.orchestrator_session_id !== orchestrator.orchestrator_session_id,
          );
          return [...without, orchestrator];
        },
      );
    },
  });
}

export function useCancelManagedOrchestrator() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, orchestratorId }: { sessionId: string; orchestratorId: string }) =>
      api.cancelManagedOrchestrator(sessionId, orchestratorId),
    onSuccess: (orchestrator, variables) => {
      client.setQueryData<ManagedOrchestratorRecord[]>(
        queryKeys.managedOrchestrators(variables.sessionId),
        (orchestrators = []) =>
          orchestrators.map((candidate) =>
            candidate.orchestrator_session_id === orchestrator.orchestrator_session_id
              ? orchestrator
              : candidate,
          ),
      );
    },
  });
}

export function useSessionSpawns(sessionId: string, enabled: boolean) {
  return useQuery<SessionAssignmentRecord[]>({
    queryKey: queryKeys.sessionSpawns(sessionId),
    queryFn: ({ signal }) => api.listSessionSpawns(sessionId, signal),
    enabled,
    refetchInterval: enabled ? 1_000 : false,
    retry: false,
  });
}

export function useStartSessionSpawn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      payload,
    }: {
      sessionId: string;
      payload: StartSessionSpawnRequest;
    }) => api.startSessionSpawn(sessionId, payload),
    onSuccess: (assignment, variables) => {
      client.setQueryData<SessionAssignmentRecord[]>(
        queryKeys.sessionSpawns(variables.sessionId),
        (assignments = []) => {
          const without = assignments.filter(
            (candidate) => candidate.child_session_id !== assignment.child_session_id,
          );
          return [...without, assignment];
        },
      );
    },
  });
}

export function useCancelSessionSpawn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, childId }: { sessionId: string; childId: string }) =>
      api.cancelSessionSpawn(sessionId, childId),
    onSuccess: (assignment, variables) => {
      client.setQueryData<SessionAssignmentRecord[]>(
        queryKeys.sessionSpawns(variables.sessionId),
        (assignments = []) =>
          assignments.map((candidate) =>
            candidate.child_session_id === assignment.child_session_id ? assignment : candidate,
          ),
      );
    },
  });
}

export function useSessionInbox(sessionId: string, enabled: boolean) {
  return useQuery<InboxItem[]>({
    queryKey: queryKeys.sessionInbox(sessionId),
    queryFn: ({ signal }) => api.listInbox(sessionId, signal),
    enabled,
    refetchInterval: enabled ? 1000 : false,
    retry: false,
  });
}

export function useCreateInboxItem() {
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
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      itemId,
      expectedVersion,
      delivery,
      prompt,
    }: {
      sessionId: string;
      itemId: number;
      expectedVersion: number;
      delivery: InboxDelivery;
      prompt?: string;
    }) =>
      prompt === undefined
        ? api.updateInboxItem(sessionId, itemId, expectedVersion, delivery)
        : api.updateInboxItem(sessionId, itemId, expectedVersion, delivery, prompt),
    onSuccess: (item, { sessionId }) => {
      client.setQueryData<InboxItem[]>(queryKeys.sessionInbox(sessionId), (items = []) =>
        items.map((candidate) => (candidate.id === item.id ? item : candidate)),
      );
    },
  });
}

export function useReorderInboxItems() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, itemIds }: { sessionId: string; itemIds: number[] }) =>
      api.reorderInboxItems(sessionId, itemIds),
    onSuccess: (items, { sessionId }) => {
      client.setQueryData(queryKeys.sessionInbox(sessionId), items);
    },
  });
}

export function useCancelInboxItem() {
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
