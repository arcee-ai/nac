import { createNacApi } from "../../../packages/nac-client/src/api.js";
import { nacClient } from "./nacClient";
export * from "../../../packages/nac-client/src/api.js";
export type NativeApi = ReturnType<typeof createNacApi> & {
    getManagedUpgrade(signal?: AbortSignal): Promise<unknown>;
    startManagedUpgrade(idempotencyKey: string): Promise<unknown>;
    generateOverview(id: string): Promise<{
        session_id: string;
        summary: string;
    }>;
};
export declare function createNativeApi(client: typeof nacClient): NativeApi;
export declare const api: NativeApi;
