import { createNacApi } from "../../../packages/nac-client/src/api.js";
import type { TaskLaunchRecord, TaskLaunchRequest, TaskLaunchSourceInfo } from "../types/api";
import { nacClient } from "./nacClient";
export * from "../../../packages/nac-client/src/api.js";
export type NativeApi = ReturnType<typeof createNacApi> & {
    startTaskLaunch(request: TaskLaunchRequest): Promise<TaskLaunchRecord>;
    taskLaunchStatus(id: string, signal?: AbortSignal): Promise<TaskLaunchRecord>;
    taskLaunchInventory(projectId: string, signal?: AbortSignal): Promise<TaskLaunchRecord[]>;
    taskLaunchSource(projectId: string, signal?: AbortSignal): Promise<TaskLaunchSourceInfo>;
    cancelTaskLaunch(id: string): Promise<TaskLaunchRecord>;
    getManagedUpgrade(signal?: AbortSignal): Promise<unknown>;
    startManagedUpgrade(idempotencyKey: string): Promise<unknown>;
    generateOverview(id: string): Promise<{
        session_id: string;
        summary: string;
    }>;
};
export declare function createNativeApi(client: typeof nacClient, productContextBinding?: string): NativeApi;
export declare const api: NativeApi;
