import type { SessionBehavior } from "@/app/types/api";

export const SESSION_BEHAVIORS: Array<{
  id: SessionBehavior;
  label: string;
  description: string;
}> = [
  {
    id: "orchestrator",
    label: "NAC orchestrator",
    description: "Plans the work and coordinates NAC worker threads.",
  },
  {
    id: "direct",
    label: "Direct coding agent",
    description: "Works directly with files and terminals and can delegate to coding agents.",
  },
  {
    id: "direct-with-orchestrator",
    label: "Direct + NAC orchestration",
    description: "A direct coding agent that can also launch separate NAC orchestrator sessions.",
  },
];

export function sessionBehaviorLabel(behavior: SessionBehavior): string {
  return SESSION_BEHAVIORS.find((option) => option.id === behavior)?.label ?? behavior;
}
