import type { SessionBehavior } from "../../types/api";
interface ChildControlsProps {
    sessionId: string;
    behavior: SessionBehavior | null;
    /** The toolbar glyph. The spawn menu opens the same dialog without it. */
    showTrigger?: boolean;
    /** Increments to open the dialog from outside the trigger. */
    openRequest?: number;
}
/** Direct-primary controls for durable traditional child coding sessions. */
export declare function ChildControls({ sessionId, behavior, showTrigger, openRequest, }: ChildControlsProps): import("react").JSX.Element | null;
export {};
