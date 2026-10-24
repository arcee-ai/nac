import { IconName } from "@/app/atoms/icon";
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
    inspection: "Insights and Worksets show the plan and worker progress.",
  },
  {
    id: "direct",
    label: "Direct coding agent",
    navigationLabel: "Direct",
    topLevel: "One persistent coding agent handles the top-level conversation.",
    editsDirectly: true,
    editing: "The top-level agent edits files and runs commands directly.",
    delegation: "It can launch fresh-context traditional coding agents.",
    inspection: "Subagents shows those traditional child sessions.",
  },
  {
    id: "direct-with-orchestrator",
    label: "Direct + NAC orchestration",
    navigationLabel: "Direct + NAC",
    topLevel: "One persistent coding agent handles the top-level conversation.",
    editsDirectly: true,
    editing: "The top-level agent edits files and runs commands directly.",
    delegation: "It can launch traditional coding agents and separate NAC orchestrator sessions.",
    inspection: "Subagents keeps both delegated topologies distinct.",
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

/**
 * The session-type glyph, matching the new-session choices. A delegated
 * session's durable relationship decides over its behavior, because the
 * Subagents rows know only which topology they launched.
 */
export function sessionBehaviorIcon(
  behavior: SessionBehavior | null | undefined,
  lineage?: SessionLineage["kind"] | null,
): IconName {
  if (lineage === "managed-orchestrator") return IconName.Orchestrator;
  if (lineage === "traditional-child") return IconName.Plane;
  switch (behavior) {
    case "direct":
      return IconName.Plane;
    case "direct-with-orchestrator":
      return IconName.PlaneAdd;
    default:
      return IconName.Orchestrator;
  }
}

/** What `sessionBehaviorIcon` draws, for the accessible name beside the glyph. */
export function sessionBehaviorName(
  behavior: SessionBehavior | null | undefined,
  lineage?: SessionLineage["kind"] | null,
): string {
  if (lineage === "managed-orchestrator") return "NAC orchestrator";
  if (lineage === "traditional-child") return "Coding agent";
  return sessionBehaviorPresentation(behavior).label;
}

export interface SessionPanelPolicy {
  widePanels: readonly SessionPanel[];
  mobilePanels: readonly SessionPanel[];
  defaultPanel: SessionPanel;
  readOnly: boolean;
}

const ORCHESTRATOR_PANELS: SessionPanelPolicy = {
  widePanels: ["insights", "files", "worksets"],
  mobilePanels: ["insights", "files", "worksets", "history"],
  defaultPanel: "insights",
  readOnly: false,
};

const DIRECT_PANELS: SessionPanelPolicy = {
  widePanels: ["insights", "delegated", "files", "terminal"],
  mobilePanels: ["insights", "delegated", "files", "terminal", "history"],
  defaultPanel: "insights",
  readOnly: false,
};

const TRADITIONAL_CHILD_PANELS: SessionPanelPolicy = {
  widePanels: ["insights", "files"],
  mobilePanels: ["insights", "files", "history"],
  defaultPanel: "insights",
  readOnly: true,
};

const MANAGED_ORCHESTRATOR_PANELS: SessionPanelPolicy = {
  ...ORCHESTRATOR_PANELS,
  readOnly: true,
};

/**
 * Session ownership and panel topology are related but distinct. Every
 * delegated transcript is read-only, while the durable relationship kind says
 * whether that transcript owns an orchestrator's Worksets or is a traditional
 * child with Insights, Files and History only.
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
