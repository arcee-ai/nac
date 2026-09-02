import ChildSessionBadge from "@/app/atoms/child-session-badge";
import type { AgentToolsGroup } from "@/app/lib/agentSegments";
import { useSpawnedChildSession } from "@/app/hooks/useSpawnedChildSession";

export function SpawnedSessionCard({
  group,
  parentSessionId,
  active = false,
  inert = false,
  onSelect,
}: {
  group: AgentToolsGroup;
  parentSessionId: string;
  active?: boolean;
  /** Preview transcripts show the card but do not select or control it. */
  inert?: boolean;
  onSelect?: (id: string) => void;
}) {
  const child = useSpawnedChildSession(parentSessionId, group);
  const state = child.missing ? "missing" : child.running ? "running" : "ready";
  return (
    <ChildSessionBadge
      title={child.title}
      lines={child.lines}
      sessionType={child.sessionType}
      state={state}
      active={active && !inert}
      busy={child.busy}
      canOpen={Boolean(child.childId) && !child.missing}
      inert={inert}
      onSelect={inert ? undefined : () => onSelect?.(group.id)}
      onPause={inert ? undefined : () => void child.pause()}
      onPlay={inert ? undefined : () => void child.play()}
      onStop={inert ? undefined : () => void child.stop()}
      onOpen={inert ? undefined : child.open}
    />
  );
}
