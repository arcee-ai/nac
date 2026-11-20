import type { SandboxRequest } from "../../types/api";
export interface SandboxOptions {
    noMount: boolean;
    image: string;
    gpu: string;
    workdir: string;
    shm: string;
    mounts: string;
}
export declare const EMPTY_SANDBOX: SandboxOptions;
export declare function sandboxRequest(options: SandboxOptions, activityKey: string): SandboxRequest;
