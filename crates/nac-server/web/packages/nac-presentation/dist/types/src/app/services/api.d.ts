import type { HeartbeatSchedule, HeartbeatInspection, HeartbeatReceipt, HeartbeatControlRequest } from "../types/api";
import { createNacApi } from "../../../packages/nac-client/src/api.js";
import type { TaskLaunchRecord, TaskLaunchRequest, TaskLaunchSourceInfo, SessionMcpRefreshStatus } from "../types/api";
import { nacClient } from "./nacClient";
export * from "../../../packages/nac-client/src/api.js";
export type NativeApi = ReturnType<typeof createNacApi> & {
    sessionIntegrations(id: string, signal?: AbortSignal): Promise<SessionMcpRefreshStatus>;
    refreshSessionIntegrations(id: string, expectedRevision: number): Promise<SessionMcpRefreshStatus>;
    heartbeatInventory(sessionId?: string, signal?: AbortSignal): Promise<HeartbeatSchedule[]>;
    heartbeatInspection(sessionId: string, scheduleId: string, signal?: AbortSignal): Promise<HeartbeatInspection>;
    controlHeartbeat(sessionId: string, request: HeartbeatControlRequest): Promise<HeartbeatReceipt>;
    acknowledgeHeartbeats(sessionId: string, throughSequence: number): Promise<void>;
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
export declare function createNativeApi(client: typeof nacClient): NativeApi;
export declare const api: NativeApi;
