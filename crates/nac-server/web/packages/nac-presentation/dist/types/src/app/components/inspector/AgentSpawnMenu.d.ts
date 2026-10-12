import type { SessionBehavior } from "../../types/api";
interface AgentSpawnButtonProps {
    sessionId: string;
    behavior: SessionBehavior | null;
    className?: string;
    onCreateSubagent: () => void;
    onCreateOrchestrator: () => void;
}
/** "+" beside a direct agent's message field. Opens the spawn actions. */
export declare function AgentSpawnButton({ sessionId, behavior, className, onCreateSubagent, onCreateOrchestrator, }: AgentSpawnButtonProps): import("react").JSX.Element;
export {};
