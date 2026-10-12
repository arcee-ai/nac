import type { SessionBehavior } from "../../types/api";
interface OrchestratorControlsProps {
    sessionId: string;
    behavior: SessionBehavior | null;
    /** The toolbar glyph. The spawn menu opens the same dialog without it. */
    showTrigger?: boolean;
    /** Increments to open the dialog from outside the trigger. */
    openRequest?: number;
}
/** Internal durable NAC orchestration controls for the delegating direct behavior. */
export declare function OrchestratorControls({ sessionId, behavior, showTrigger, openRequest, }: OrchestratorControlsProps): import("react").JSX.Element | null;
export {};
