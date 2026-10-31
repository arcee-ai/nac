import type {
  HeartbeatSchedule,
  HeartbeatInspection,
  HeartbeatReceipt,
  HeartbeatControlRequest,
} from "@/app/types/api";
// Standalone compatibility facade; feature owners obtain their API from runtime context.
import { createNacApi } from "../../../packages/nac-client/src/api.js";
import type {
  TaskLaunchRecord,
  TaskLaunchRequest,
  TaskLaunchSourceInfo,
  SessionMcpRefreshStatus,
} from "@/app/types/api";
import { nacClient } from "@/app/services/nacClient";
export * from "../../../packages/nac-client/src/api.js";
export type NativeApi = ReturnType<typeof createNacApi> & {
  sessionIntegrations(id: string, signal?: AbortSignal): Promise<SessionMcpRefreshStatus>;
  refreshSessionIntegrations(
    id: string,
    expectedRevision: number,
  ): Promise<SessionMcpRefreshStatus>;
  heartbeatInventory(sessionId?: string, signal?: AbortSignal): Promise<HeartbeatSchedule[]>;
  heartbeatInspection(
    sessionId: string,
    scheduleId: string,
    signal?: AbortSignal,
  ): Promise<HeartbeatInspection>;
  controlHeartbeat(sessionId: string, request: HeartbeatControlRequest): Promise<HeartbeatReceipt>;
  acknowledgeHeartbeats(sessionId: string, throughSequence: number): Promise<void>;
  startTaskLaunch(request: TaskLaunchRequest): Promise<TaskLaunchRecord>;
  taskLaunchStatus(id: string, signal?: AbortSignal): Promise<TaskLaunchRecord>;
  taskLaunchInventory(projectId: string, signal?: AbortSignal): Promise<TaskLaunchRecord[]>;
  taskLaunchSource(projectId: string, signal?: AbortSignal): Promise<TaskLaunchSourceInfo>;
  cancelTaskLaunch(id: string): Promise<TaskLaunchRecord>;
  getManagedUpgrade(signal?: AbortSignal): Promise<unknown>;
  startManagedUpgrade(idempotencyKey: string): Promise<unknown>;
  generateOverview(id: string): Promise<{ session_id: string; summary: string }>;
};
export function createNativeApi(client: typeof nacClient): NativeApi {
  const request = client.transport.request.bind(client.transport);
  return {
    ...createNacApi(client),
    sessionIntegrations: (id, signal) =>
      request<SessionMcpRefreshStatus>("GET", `/sessions/${encodeURIComponent(id)}/integrations`, {
        signal,
      }),
    refreshSessionIntegrations: (id, expectedRevision) =>
      request<SessionMcpRefreshStatus>(
        "POST",
        `/sessions/${encodeURIComponent(id)}/integrations/refresh`,
        { body: { expected_revision: expectedRevision } },
      ),
    heartbeatInventory: (sessionId, signal) =>
      request<HeartbeatSchedule[]>(
        "GET",
        `/heartbeats${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`,
        { signal },
      ),
    heartbeatInspection: (sessionId, scheduleId, signal) =>
      request<HeartbeatInspection>(
        "GET",
        `/sessions/${encodeURIComponent(sessionId)}/heartbeats/${encodeURIComponent(scheduleId)}`,
        { signal },
      ),
    controlHeartbeat: (sessionId, body) =>
      request<HeartbeatReceipt>(
        "POST",
        `/sessions/${encodeURIComponent(sessionId)}/heartbeats/control`,
        { body },
      ),
    acknowledgeHeartbeats: (sessionId, throughSequence) =>
      request<void>("POST", `/sessions/${encodeURIComponent(sessionId)}/heartbeats/attention`, {
        body: { through_sequence: throughSequence },
      }),
    startTaskLaunch: (body: TaskLaunchRequest) =>
      request<TaskLaunchRecord>("POST", "/task-launches", { body }),
    taskLaunchStatus: (id: string, signal?: AbortSignal) =>
      request<TaskLaunchRecord>("GET", `/task-launches/${encodeURIComponent(id)}`, { signal }),
    taskLaunchInventory: (projectId: string, signal?: AbortSignal) =>
      request<TaskLaunchRecord[]>(
        "GET",
        `/projects/${encodeURIComponent(projectId)}/task-launches`,
        { signal },
      ),
    taskLaunchSource: (projectId: string, signal?: AbortSignal) =>
      request<TaskLaunchSourceInfo>(
        "GET",
        `/projects/${encodeURIComponent(projectId)}/task-launch-source`,
        { signal },
      ),
    cancelTaskLaunch: (id: string) =>
      request<TaskLaunchRecord>("POST", `/task-launches/${encodeURIComponent(id)}/cancel`),
    getManagedUpgrade: (signal?: AbortSignal) =>
      request<unknown>("GET", "/__managed/control/v0/upgrade", { signal }),

    startManagedUpgrade: (idempotencyKey: string) =>
      request<unknown>("POST", "/__managed/control/v0/upgrade", {
        body: {},
        headers: { "Idempotency-Key": idempotencyKey },
      }),

    generateOverview: (id: string) =>
      request<{ session_id: string; summary: string }>(
        "POST",
        `/sessions/${encodeURIComponent(id)}/overview`,
      ),
  };
}
export const api = createNativeApi(nacClient);
