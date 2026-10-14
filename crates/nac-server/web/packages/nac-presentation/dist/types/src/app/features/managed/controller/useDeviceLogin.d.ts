import type { ManagedAuthProvider } from "../../../types/api.js";
import { type DeviceLoginState } from "./deviceLoginOperation.js";
export type { DeviceLoginState } from "./deviceLoginOperation.js";
/** Local presentation detaches; accepted authentication settles its origin. */
export declare function useDeviceLogin(onSuccess?: () => void, provider?: ManagedAuthProvider | null): {
    state: DeviceLoginState;
    start: (nextProvider: ManagedAuthProvider) => Promise<void>;
    cancel: () => Promise<void>;
};
