import type { SessionStatus } from "../../../lib/sessionStatus";
import type { TraditionalChildStatus } from "../../../types/api";
/** A delegated record's lifecycle on the one status ladder every list shares. */
export declare function subagentDotStatus(status: TraditionalChildStatus): SessionStatus;
/** "now", "4m", "3h", "2d": how long ago the record last changed. */
export declare function compactAge(updatedAt: string, now: number): string;
/** The row's one line of state: its kind, where it is, and the latest word from it. */
export declare function subagentStateLine({ status, background, detail, }: {
    status: TraditionalChildStatus;
    background: boolean;
    detail: string | null;
}): string;
