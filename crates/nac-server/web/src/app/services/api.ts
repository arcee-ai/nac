// Standalone compatibility facade; feature owners obtain their API from runtime context.
import { createNacApi } from "../../../packages/nac-client/src/api.js";
import type {
  AskSelectionQuestionRequest,
  AskSelectionQuestionResponse,
  SelectionQuestion,
  SelectionQuestionList,
  TaskLaunchRecord,
  TaskLaunchRequest,
  TaskLaunchSourceInfo,
} from "@/app/types/api";
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
  askSelectionQuestion(
    sessionId: string,
    body: AskSelectionQuestionRequest,
  ): Promise<AskSelectionQuestionResponse>;
  listSelectionQuestions(sessionId: string, signal?: AbortSignal): Promise<SelectionQuestionList>;
  cancelSelectionQuestion(sessionId: string, questionId: string): Promise<SelectionQuestion>;
};
export function createNativeApi(client: typeof nacClient): NativeApi {
  const request = client.transport.request.bind(client.transport);
  return {
    ...createNacApi(client),
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

    askSelectionQuestion: (sessionId: string, body: AskSelectionQuestionRequest) =>
      request<AskSelectionQuestionResponse>(
        "POST",
        `/sessions/${encodeURIComponent(sessionId)}/selection-questions`,
        { body },
      ),
    listSelectionQuestions: (sessionId: string, signal?: AbortSignal) =>
      request<SelectionQuestionList>(
        "GET",
        `/sessions/${encodeURIComponent(sessionId)}/selection-questions`,
        { signal },
      ),
    cancelSelectionQuestion: (sessionId: string, questionId: string) =>
      request<SelectionQuestion>(
        "POST",
        `/sessions/${encodeURIComponent(sessionId)}/selection-questions/${encodeURIComponent(questionId)}/cancel`,
      ),
  };
}
export const api = createNativeApi(nacClient);
