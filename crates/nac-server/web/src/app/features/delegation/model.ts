import { formatStoreTime } from "@/app/lib/format";
import type {
  ManagedOrchestratorRecord,
  TraditionalChildRecord,
  TraditionalChildStatus,
} from "@/app/types/api";

export type DelegatedSessionKind = "coding-agent" | "nac-orchestrator";

export interface DelegatedSessionPresentation {
  kind: DelegatedSessionKind;
  id: string;
  description: string;
  typeLabel: "Coding agent" | "NAC orchestrator";
  status: TraditionalChildStatus;
  statusLabel: string;
  statusTone: "neutral" | "active" | "success" | "danger" | "warning";
  generation: number;
  modeLabel: "Foreground" | "Background" | null;
  updatedLabel: string;
  outcomeLabel: "Outcome" | "Error" | "Changes" | "Verification" | null;
  outcome: string | null;
  completionNeedsAttention: boolean;
  canSteer: boolean;
  canContinue: boolean;
  canCancel: boolean;
}

const STATUS_PRESENTATION = {
  idle: { label: "Idle", tone: "neutral" },
  running: { label: "Running", tone: "active" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "warning" },
  interrupted: { label: "Interrupted", tone: "warning" },
} as const satisfies Record<
  TraditionalChildStatus,
  { label: string; tone: DelegatedSessionPresentation["statusTone"] }
>;

function nonempty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function common(
  record: TraditionalChildRecord | ManagedOrchestratorRecord,
  kind: DelegatedSessionKind,
  id: string,
): Omit<DelegatedSessionPresentation, "outcomeLabel" | "outcome"> {
  const status = STATUS_PRESENTATION[record.status];
  const running = record.status === "running";
  return {
    kind,
    id,
    description: record.description,
    typeLabel: kind === "coding-agent" ? "Coding agent" : "NAC orchestrator",
    status: record.status,
    statusLabel: status.label,
    statusTone: status.tone,
    generation: record.generation,
    modeLabel:
      record.execution_mode === "foreground"
        ? "Foreground"
        : record.execution_mode === "background"
          ? "Background"
          : null,
    updatedLabel: formatStoreTime(record.updated_at),
    completionNeedsAttention: record.status !== "running" && record.completion_inbox_id != null,
    canSteer: running,
    canContinue: !running,
    canCancel: running,
  };
}

export function presentTraditionalChild(
  child: TraditionalChildRecord,
): DelegatedSessionPresentation {
  const failure = nonempty(child.failure);
  const report = nonempty(child.report);
  const changes = nonempty(child.change_summary);
  const verification = nonempty(child.verification_summary);
  return {
    ...common(child, "coding-agent", child.child_session_id),
    outcomeLabel: failure
      ? "Error"
      : report
        ? "Outcome"
        : changes
          ? "Changes"
          : verification
            ? "Verification"
            : null,
    outcome: failure ?? report ?? changes ?? verification,
  };
}

export function presentManagedOrchestrator(
  orchestrator: ManagedOrchestratorRecord,
): DelegatedSessionPresentation {
  const failure = nonempty(orchestrator.failure);
  const report = nonempty(orchestrator.report);
  return {
    ...common(orchestrator, "nac-orchestrator", orchestrator.orchestrator_session_id),
    outcomeLabel: failure ? "Error" : report ? "Outcome" : null,
    outcome: failure ?? report,
  };
}
