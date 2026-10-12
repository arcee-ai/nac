import { type QueryClient } from "@tanstack/react-query";
import type { DeviceLoginStarted, ManagedAuthProvider } from "../../../types/api";
export type DeviceLoginState = {
    status: "idle";
} | {
    status: "starting";
} | {
    status: "waiting";
    prompt: DeviceLoginStarted;
} | {
    status: "failed";
    message: string;
};
interface Attempt {
    provider: ManagedAuthProvider;
    prompt?: DeviceLoginStarted;
    cancelled: boolean;
    dispose?: () => void;
}
export interface DeviceLoginOperation {
    attempt: Attempt;
    state: DeviceLoginState;
    completed: boolean;
}
export declare const deviceLoginKey: (provider: ManagedAuthProvider | null) => readonly ["provider-device-login-attempt", "arcee" | "codex" | null];
/** One provider attempt per origin QueryClient; no persisted browser credential. */
export declare function startDeviceLogin(client: QueryClient, provider: ManagedAuthProvider): Promise<{
    attempt: Attempt;
    fresh: boolean;
}>;
/** Explicit Cancel, including start races, alone abandons the durable login. */
export declare function cancelDeviceLogin(client: QueryClient, provider: ManagedAuthProvider): Promise<void>;
export {};
