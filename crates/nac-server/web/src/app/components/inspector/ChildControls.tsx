import { useDelegatedPermissionStream } from "@/app/hooks/useSessionStream";
import { isAgentBehavior } from "@/app/lib/sessionBehavior";
import { useTraditionalChildren } from "@/app/services/queries";
import type { SessionBehavior, TraditionalChildRecord } from "@/app/types/api";

interface ChildControlsProps {
  sessionId: string;
  behavior: SessionBehavior | null;
}

function ChildPermissionBridge({ child }: { child: TraditionalChildRecord }) {
  const running = child.status === "running";
  useDelegatedPermissionStream(child.child_session_id, running);
  return null;
}

/**
 * Keeps parent-side permission streams alive for model-spawned children.
 * Users cannot launch traditional children from the composer.
 */
export function ChildControls({ sessionId, behavior }: ChildControlsProps) {
  const direct = isAgentBehavior(behavior);
  const childrenQuery = useTraditionalChildren(sessionId, direct);
  if (!direct) return null;

  return (
    <>
      {(childrenQuery.data ?? []).map((child) => (
        <ChildPermissionBridge key={child.child_session_id} child={child} />
      ))}
    </>
  );
}
