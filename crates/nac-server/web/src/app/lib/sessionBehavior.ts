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
    id: "direct",
    label: "Agent",
    navigationLabel: "Agent",
    topLevel: "One persistent coding agent handles the top-level conversation.",
    editsDirectly: true,
    editing: "The agent edits files and runs commands directly.",
    delegation: "It can launch child coding agents.",
    inspection: "Subagents shows child sessions.",
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
  _behavior: SessionBehavior | null | undefined,
  _lineage?: SessionLineage["kind"] | null,
): IconName {
  return IconName.Plane;
}

export function sessionBehaviorName(
  _behavior: SessionBehavior | null | undefined,
  lineage?: SessionLineage["kind"] | null,
): string {
  return lineage === "traditional-child" ? "Subagent" : "Agent";
}

export interface SessionPanelPolicy {
  widePanels: readonly SessionPanel[];
  mobilePanels: readonly SessionPanel[];
  defaultPanel: SessionPanel;
  readOnly: boolean;
}

const DIRECT_PANELS: SessionPanelPolicy = {
  widePanels: ["insights", "delegated", "files", "terminal"],
  mobilePanels: ["insights", "delegated", "files", "terminal", "history"],
  defaultPanel: "insights",
  readOnly: false,
};

const HEARTBEAT_PANELS: SessionPanelPolicy = {
  ...DIRECT_PANELS,
  widePanels: [...DIRECT_PANELS.widePanels, "heartbeats"],
  mobilePanels: [...DIRECT_PANELS.mobilePanels, "heartbeats"],
};

const TRADITIONAL_CHILD_PANELS: SessionPanelPolicy = {
  widePanels: ["insights", "files"],
  mobilePanels: ["insights", "files", "history"],
  defaultPanel: "insights",
  readOnly: true,
};

/** Child sessions have a read-only transcript; primary sessions expose the direct panels. */
export function sessionPanelPolicy(
  _behavior: SessionBehavior | null | undefined,
  lineageKind: SessionLineage["kind"] | null | undefined,
): SessionPanelPolicy {
  return lineageKind === "traditional-child" ? TRADITIONAL_CHILD_PANELS : HEARTBEAT_PANELS;
}
