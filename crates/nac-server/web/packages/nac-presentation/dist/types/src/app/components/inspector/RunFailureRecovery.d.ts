import type { RunFailure, SessionGoalRecord } from "../../types/api";
/** A run's durable failure with its recovery, a sign-in first for a refused login. */
export declare function RunFailureRecovery({ failure, goal, backend, onResumeGoal, onOpenSettings, onRegenerate, }: {
    failure: RunFailure;
    goal: SessionGoalRecord | null | undefined;
    backend: string | null;
    onResumeGoal: () => void;
    onOpenSettings: () => void;
    onRegenerate: (() => void) | null;
}): import("react").JSX.Element;
export declare function RunFailureNotice({ failure, goal, action, }: {
    failure: RunFailure;
    goal?: SessionGoalRecord | null;
    action?: {
        label: string;
        onClick: () => void;
    };
}): import("react").JSX.Element;
