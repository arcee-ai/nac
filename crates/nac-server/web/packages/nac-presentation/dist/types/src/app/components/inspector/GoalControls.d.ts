import type { SessionBehavior } from "../../types/api";
interface GoalControlsProps {
    sessionId: string;
    behavior: SessionBehavior | null;
    openRequest?: number;
}
/** Direct-only durable goal state and user controls. */
export declare function GoalControls({ sessionId, behavior, openRequest }: GoalControlsProps): import("react").JSX.Element | null;
export {};
