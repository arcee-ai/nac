// Standalone compatibility facade; feature owners obtain their API from runtime context.
import { createNacApi } from "../../../packages/nac-client/src/api.js";
import type { TaskLaunchRecord, TaskLaunchRequest, TaskLaunchSourceInfo } from "@/app/types/api";
import { nacClient } from "@/app/services/nacClient";
export * from "../../../packages/nac-client/src/api.js";
export type NativeApi = ReturnType<typeof createNacApi> & {
  startTaskLaunch(request: TaskLaunchRequest): Promise<TaskLaunchRecord>;
  taskLaunchStatus(id: string, signal?: AbortSignal): Promise<TaskLaunchRecord>;
  taskLaunchInventory(projectId: string, signal?: AbortSignal): Promise<TaskLaunchRecord[]>;
  taskLaunchSource(projectId: string, signal?: AbortSignal): Promise<TaskLaunchSourceInfo>;
  cancelTaskLaunch(id: string): Promise<TaskLaunchRecord>;
  getManagedUpgrade(signal?: AbortSignal): Promise<unknown>;
  startManagedUpgrade(idempotencyKey: string): Promise<unknown>;
  generateOverview(id: string): Promise<{ session_id: string; summary: string }>;
};
export function createNativeApi(
  client: typeof nacClient,
  productContextBinding?: string,
): NativeApi {
  const request = client.transport.request.bind(client.transport);
  return {
    ...createNacApi(client, { productContextBinding }),
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
