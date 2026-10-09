import type { LaunchModelSelection } from "../../components/modals/ConfigurationsPanel";
import type { LightSelection } from "../../components/modals/LightModelSection";
import { type UiPolicy } from "../ui-policy/policy";
import type { CreateSessionRequest, LightModelSettings, SessionBehavior } from "../../types/api";
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
    policy: UiPolicy;
    behavior: SessionBehavior;
    reasoning: string;
    headers: Record<string, string> | undefined;
    compaction: string;
    presetCompaction: boolean;
    savedLight: LightModelSettings | null | undefined;
    light: LightSelection;
    execution: "local" | "ssh" | "sandbox";
    sandbox: SandboxOptions;
    activityKey: string | null;
}): CreateSessionRequest;
