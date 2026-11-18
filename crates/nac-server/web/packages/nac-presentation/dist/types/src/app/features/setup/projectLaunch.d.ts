import type { LaunchModelSelection } from "./modelSelection";
import type { CreateSessionRequest } from "../../types/api";
export interface SandboxOptions {
    noMount: boolean;
    image: string;
    gpu: string;
    workdir: string;
    shm: string;
    mounts: string;
}
/** Compose explicit overrides once; a project's location is never restated on its chat. */
export declare function projectChatRequest(values: {
    projectId: string;
    selected: Extract<LaunchModelSelection, {
        kind: "resolved";
    }>;
    reasoning: string;
    headers: Record<string, string> | undefined;
    compaction: string;
    automaticCompaction: boolean;
    execution: "local" | "ssh" | "sandbox";
    sandbox: SandboxOptions;
    activityKey: string | null;
}): CreateSessionRequest;
