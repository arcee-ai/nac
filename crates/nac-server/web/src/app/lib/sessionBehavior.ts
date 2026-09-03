import {
  compactSessionTitle,
  isPlaceholderSessionTitle,
} from "@/app/lib/format";
import type { SessionPanel } from "@/app/lib/routes";
import type { SessionBehavior, SessionLineage } from "@/app/types/api";

export interface SessionBehaviorPresentation {
  id: SessionBehavior;
  label: string;
  navigationLabel: string;
  createLabel: string;
  topLevel: string;
  editsDirectly: boolean;
  editing: string;
  delegation: string;
  inspection: string;
  /** Hover-hint copy: what this type does and when to pick it. */
  hint: string;
}

const AGENT_PRESENTATION: SessionBehaviorPresentation = {
  id: "direct",
  label: "Agent",
  navigationLabel: "Agent",
  createLabel: "New Agent",
  topLevel: "One persistent coding agent handles the top-level conversation.",
  editsDirectly: true,
  editing: "The top-level agent edits files and runs commands directly.",
  delegation:
    "It can launch fresh-context coding agents and separate Orchestrator sessions.",
  inspection: "Actions show reasoning, tool calls, and spawned sessions.",
  hint: "A persistent coding agent that edits files and runs commands itself. Best for hands-on implementation, debugging, and iterating in one conversation.",
};

export const SESSION_BEHAVIORS: readonly SessionBehaviorPresentation[] = [
  AGENT_PRESENTATION,
  {
    id: "orchestrator",
    label: "Orchestrator",
    navigationLabel: "Orchestrator",
    createLabel: "New Orchestrator",
    topLevel: "A planner handles the top-level conversation.",
    editsDirectly: false,
    editing: "The planner does not edit directly.",
    delegation: "It delegates coding to retained Orchestrator worker threads.",
    inspection: "Actions and Worksets show the plan and worker progress.",
    hint: "A planner that delegates coding to worker threads. Best for large tasks you want broken into parallel work.",
  },
];

/** New chats may only choose Agent or Orchestrator. Old hybrid rows present as Agent. */
export const CREATE_SESSION_BEHAVIORS: readonly SessionBehaviorPresentation[] =
  SESSION_BEHAVIORS;

export function isAgentBehavior(
  behavior: SessionBehavior | null | undefined,
): boolean {
  return behavior === "direct" || behavior === "direct-with-orchestrator";
}

export function sessionBehaviorPresentation(
  behavior: SessionBehavior | null | undefined,
): SessionBehaviorPresentation {
  if (behavior === "direct-with-orchestrator") {
    return { ...AGENT_PRESENTATION, id: "direct-with-orchestrator" };
  }
  return (
    SESSION_BEHAVIORS.find((option) => option.id === behavior) ??
    SESSION_BEHAVIORS[1]
  );
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
  widePanels: ["actions", "threads", "files", "worksets"],
  mobilePanels: ["actions", "threads", "files", "worksets", "history"],
  defaultPanel: "actions",
  readOnly: false,
};

const DIRECT_PANELS: SessionPanelPolicy = {
  widePanels: ["actions", "files", "delegated"],
  mobilePanels: ["actions", "files", "delegated", "history"],
  defaultPanel: "actions",
  readOnly: false,
};

const TRADITIONAL_CHILD_PANELS: SessionPanelPolicy = {
  widePanels: ["actions", "files"],
  mobilePanels: ["actions", "files", "history"],
  defaultPanel: "actions",
  readOnly: true,
};

const MANAGED_ORCHESTRATOR_PANELS: SessionPanelPolicy = {
  ...ORCHESTRATOR_PANELS,
  readOnly: true,
};

export type AssignmentStatus =
  "idle" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export function assignmentIsOpen(
  status: AssignmentStatus | string | null | undefined,
): boolean {
  return status === "idle" || status === "running";
}

/** Composer and message-action copy when the child is still parent-owned. */
export const DELEGATED_READONLY_HINT =
  "This delegated transcript is read-only. Continue, steer, or cancel it from its parent chat.";

/** Message-action copy for turns frozen after the assignment settled. */
export const FROZEN_DELEGATED_TURN_HINT =
  "This turn is locked. It belongs to a finished delegated assignment.";

export function sessionTypeFromBehavior(
  behavior: SessionBehavior | null | undefined,
): "agent" | "orchestrator" {
  return isAgentBehavior(behavior) ? "agent" : "orchestrator";
}

export function sessionOriginFromRecord(
  lineage: SessionLineage | null | undefined,
  forkedFrom: unknown,
  convertedFrom?: unknown,
): "user" | "fork" | "converted" | "delegated" | "delegated-locked" {
  if (lineage) {
    return assignmentIsOpen(lineage.assignment_status)
      ? "delegated-locked"
      : "delegated";
  }
  if (forkedFrom) return "fork";
  if (convertedFrom) return "converted";
  return "user";
}

/**
 * Extra sentence on the session-avatar tooltip: fork source, conversion, or
 * that an Agent spawned this chat. The type label sits in front of this.
 */
function compactOriginTitle(title: string | null | undefined): string {
  return compactSessionTitle(title ?? "").trim();
}

export function sessionOriginDetail(options: {
  origin: ReturnType<typeof sessionOriginFromRecord>;
  forkedFromTitle?: string | null;
  convertedFromTitle?: string | null;
  convertedFromType?: string | null;
}): string | undefined {
  switch (options.origin) {
    case "fork": {
      const source = compactOriginTitle(options.forkedFromTitle);
      return source ? `Fork of ${source}` : "Fork";
    }
    case "converted": {
      const source = compactOriginTitle(options.convertedFromTitle);
      const typeLabel = options.convertedFromType?.trim();
      if (source && !isPlaceholderSessionTitle(source))
        return `Converted from ${source}`;
      if (typeLabel) return `Converted from ${typeLabel}`;
      return "Converted from another session type";
    }
    case "delegated":
    case "delegated-locked":
      return "Created by an Agent";
    default:
      return undefined;
  }
}

export function sessionAvatarTooltipDescription(
  typeLabel: string | undefined,
  originDetail: string | undefined,
): string | undefined {
  if (typeLabel && originDetail) return `${typeLabel}. ${originDetail}`;
  return typeLabel || originDetail;
}

/**
 * Session ownership and panel topology are related but distinct. An open
 * assignment keeps the child read-only; after settle the session uses the
 * same panels as a user-created Agent or Orchestrator.
 */
export function sessionPanelPolicy(
  behavior: SessionBehavior | null | undefined,
  lineageKind: SessionLineage["kind"] | null | undefined,
  assignmentStatus?: AssignmentStatus | string | null,
): SessionPanelPolicy {
  const open = assignmentIsOpen(assignmentStatus);
  if (lineageKind === "traditional-child") {
    return open ? TRADITIONAL_CHILD_PANELS : DIRECT_PANELS;
  }
  if (lineageKind === "managed-orchestrator") {
    return open ? MANAGED_ORCHESTRATOR_PANELS : ORCHESTRATOR_PANELS;
  }
  return sessionBehaviorPresentation(behavior).id === "orchestrator"
    ? ORCHESTRATOR_PANELS
    : DIRECT_PANELS;
}

/** Side-box tab that hosts the Actions timeline. */
export function actionsPanel(
  _behavior: SessionBehavior | null | undefined,
): SessionPanel {
  return "actions";
}
