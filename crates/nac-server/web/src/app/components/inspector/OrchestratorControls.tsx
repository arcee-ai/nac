import { isAgentBehavior } from "@/app/lib/sessionBehavior";
import type { SessionBehavior } from "@/app/types/api";

interface OrchestratorControlsProps {
  sessionId: string;
  behavior: SessionBehavior | null;
}

/**
 * Users cannot launch managed orchestrators from the composer.
 * The model uses subagent / orchestrator_launch; completion events stay on the parent transcript.
 */
export function OrchestratorControls({
  sessionId: _sessionId,
  behavior,
}: OrchestratorControlsProps) {
  if (!isAgentBehavior(behavior)) return null;
  return null;
}
