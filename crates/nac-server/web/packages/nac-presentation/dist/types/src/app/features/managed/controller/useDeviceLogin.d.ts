import type { ManagedAuthProvider } from "../../../types/api";
import { type DeviceLoginState } from "./deviceLoginOperation";
export type { DeviceLoginState } from "./deviceLoginOperation";
/** Local presentation detaches; accepted authentication settles its origin. */
export declare function useDeviceLogin(onSuccess?: () => void, provider?: ManagedAuthProvider | null): {
    state: DeviceLoginState;
    start: (nextProvider: ManagedAuthProvider) => Promise<void>;
    cancel: () => Promise<void>;
};
