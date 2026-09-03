import type { SessionPanel } from "@/app/lib/routes";
import type { SessionBehavior, SessionLineage } from "@/app/types/api";

export interface SessionBehaviorPresentation {
  id: SessionBehavior;
  label: string;
  navigationLabel: string;
  topLevel: string;
  editsDirectly: boolean;
  editing: string;
  delegation: string;
  inspection: string;
}

export const SESSION_BEHAVIORS: readonly SessionBehaviorPresentation[] = [
  {
    id: "orchestrator",
    label: "NAC orchestrator",
    navigationLabel: "Orchestrator",
    topLevel: "A planner handles the top-level conversation.",
    editsDirectly: false,
    editing: "The planner does not edit directly.",
    delegation: "It delegates coding to retained NAC worker threads.",
    inspection: "Threads and Worksets show the plan and worker progress.",
  },
  {
    id: "direct",
    label: "Direct coding agent",
    navigationLabel: "Direct",
    topLevel: "One persistent coding agent handles the top-level conversation.",
    editsDirectly: true,
    editing: "The top-level agent edits files and runs commands directly.",
    delegation: "It can launch fresh-context traditional coding agents.",
    inspection: "Delegated work shows those traditional child sessions.",
  },
  {
    id: "direct-with-orchestrator",
    label: "Direct + NAC orchestration",
    navigationLabel: "Direct + NAC",
    topLevel: "One persistent coding agent handles the top-level conversation.",
    editsDirectly: true,
    editing: "The top-level agent edits files and runs commands directly.",
    delegation: "It can launch traditional coding agents and separate NAC orchestrator sessions.",
    inspection: "Delegated work keeps both delegated topologies distinct.",
  },
];

export function sessionBehaviorPresentation(
  behavior: SessionBehavior | null | undefined,
): SessionBehaviorPresentation {
  return SESSION_BEHAVIORS.find((option) => option.id === behavior) ?? SESSION_BEHAVIORS[0];
}

export function sessionBehaviorLabel(behavior: SessionBehavior): string {
  return sessionBehaviorPresentation(behavior).label;
}

export interface SessionPanelPolicy {
  widePanels: readonly SessionPanel[];
  mobilePanels: readonly SessionPanel[];
  defaultPanel: SessionPanel;
  readOnly: boolean;
}

const ORCHESTRATOR_PANELS: SessionPanelPolicy = {
  widePanels: ["threads", "files", "worksets"],
  mobilePanels: ["threads", "files", "worksets", "history"],
  defaultPanel: "threads",
  readOnly: false,
};

const DIRECT_PANELS: SessionPanelPolicy = {
  widePanels: ["delegated", "files"],
  mobilePanels: ["delegated", "files", "history"],
  defaultPanel: "delegated",
  readOnly: false,
};

const TRADITIONAL_CHILD_PANELS: SessionPanelPolicy = {
  widePanels: ["files"],
  mobilePanels: ["files", "history"],
  defaultPanel: "files",
  readOnly: true,
};

const MANAGED_ORCHESTRATOR_PANELS: SessionPanelPolicy = {
  ...ORCHESTRATOR_PANELS,
  readOnly: true,
};

/**
 * Session ownership and panel topology are related but distinct. Every
 * delegated transcript is read-only, while the durable relationship kind says
 * whether that transcript owns an orchestrator's Threads and Worksets or is a
 * traditional child with Files/History only.
 */
export function sessionPanelPolicy(
  behavior: SessionBehavior | null | undefined,
  lineageKind: SessionLineage["kind"] | null | undefined,
): SessionPanelPolicy {
  if (lineageKind === "traditional-child") return TRADITIONAL_CHILD_PANELS;
  if (lineageKind === "managed-orchestrator") return MANAGED_ORCHESTRATOR_PANELS;
  return sessionBehaviorPresentation(behavior).id === "orchestrator"
    ? ORCHESTRATOR_PANELS
    : DIRECT_PANELS;
}
