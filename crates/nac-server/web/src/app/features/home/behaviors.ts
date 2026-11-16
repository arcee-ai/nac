import type { UiPolicy } from "@/app/features/ui-policy/policy";
import type { SessionBehavior } from "@/app/types/api";

/** Display vocabulary for the immutable behavior values (persisted ids unchanged). */
export const BEHAVIOR_CHOICES: readonly {
  id: SessionBehavior;
  label: string;
  hint: string;
}[] = [
  {
    id: "direct",
    label: "Agent",
    hint: "One coding agent edits and runs commands directly.",
  },
  {
    id: "direct-with-orchestrator",
    label: "Agent + Orchestrator",
    hint: "An agent that can also launch separate orchestrated sessions.",
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    hint: "A planner that delegates coding to worker threads.",
  },
];

export function behaviorLabel(behavior: SessionBehavior): string {
  return BEHAVIOR_CHOICES.find((choice) => choice.id === behavior)?.label ?? "Agent";
}

/** The pickers' long-standing default: orchestrator where orchestration exists. */
export function defaultBehavior(policy: UiPolicy): SessionBehavior {
  return policy.orchestrationEnabled ? "orchestrator" : "direct";
}
