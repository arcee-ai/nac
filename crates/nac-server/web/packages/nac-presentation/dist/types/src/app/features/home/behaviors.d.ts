import type { UiPolicy } from "../ui-policy/policy";
import type { SessionBehavior } from "../../types/api";
/** Display vocabulary for the immutable behavior values (persisted ids unchanged). */
export declare const BEHAVIOR_CHOICES: readonly {
    id: SessionBehavior;
    label: string;
    hint: string;
}[];
export declare function behaviorLabel(behavior: SessionBehavior): string;
/** The pickers' long-standing default: orchestrator where orchestration exists. */
export declare function defaultBehavior(policy: UiPolicy): SessionBehavior;
