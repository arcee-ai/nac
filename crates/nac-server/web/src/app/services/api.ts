// Standalone compatibility facade; feature owners obtain their API from runtime context.
import { createNacApi } from "../../../packages/nac-client/src/api.js";
import { nacClient } from "@/app/services/nacClient";
export * from "../../../packages/nac-client/src/api.js";
export type NativeApi = ReturnType<typeof createNacApi> & {
  getManagedUpgrade(signal?: AbortSignal): Promise<unknown>;
  startManagedUpgrade(idempotencyKey: string): Promise<unknown>;
  generateOverview(id: string): Promise<{ session_id: string; summary: string }>;
};
export function createNativeApi(client: typeof nacClient): NativeApi {
  const request = client.transport.request.bind(client.transport);
  return {
    ...createNacApi(client),
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
