import { useEffect, useMemo, useState } from "react";

import {
  Button,
  ButtonSize,
  ButtonVariant,
  ChatSessionButton,
  Icon,
  IconName,
  TabButton,
  TabButtonSize,
} from "@/app/atoms";
import { ChildTranscriptPreview } from "@/app/components/inspector/ChildTranscriptPreview";
import { GroupLabel } from "@/app/components/projects/GroupLabel";
import { SpawnComposeForm } from "@/app/features/delegation/presentation/SpawnComposeForm";
import { presentSessionAssignment } from "@/app/features/delegation/model";
import {
  PanelEmpty,
  PanelLoading,
  PanelSplit,
} from "@/app/components/inspector/PanelSplit";
import { useNow } from "@/app/hooks/useNow";
import { SESSION_PANEL_LABEL } from "@/app/lib/routes";
import { groupByRecency } from "@/app/lib/projects";
import {
  assignmentIsOpen,
  canLaunchManagedOrchestrator,
  isAgentBehavior,
  sessionTypeFromBehavior,
} from "@/app/lib/sessionBehavior";
import { showSidePanelList } from "@/app/store/sessionLayoutStore";
import { useSessionSpawns } from "@/app/services/queries";
import type { SessionAssignmentChildBehavior, SessionBehavior } from "@/app/types/api";

const RECENCY_TICK_MS = 60_000;

function QueryError({ label, retry }: { label: string; retry: () => void }) {
  return (
    <div role="alert" className="rounded-[6px] border border-error-primary p-3">
      <div className="text-small text-error-primary">
        {label} could not be loaded.
      </div>
      <Button
        className="mt-2"
        size={ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        onClick={retry}
      >
        Try again
      </Button>
    </div>
  );
}

export function DelegatedWorkView({
  sessionId,
  behavior,
  selected,
  onSelect,
}: {
  sessionId: string;
  behavior: SessionBehavior;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const enabled = isAgentBehavior(behavior);
  const assignments = useSessionSpawns(sessionId, enabled);
  const now = useNow(RECENCY_TICK_MS, enabled);
  const [compose, setCompose] = useState<SessionAssignmentChildBehavior | null>(
    null,
  );
  const rows = (assignments.data ?? []).map(presentSessionAssignment);
  const current =
    compose != null
      ? null
      : (rows.find((row) => row.id === selected) ?? rows[0] ?? null);

  useEffect(() => {
    setCompose(null);
  }, [sessionId]);

  const groups = useMemo(() => {
    const records = [...(assignments.data ?? [])].sort((left, right) =>
      right.updated_at.localeCompare(left.updated_at),
    );
    return groupByRecency(
      records,
      (record) => ({ updatedAt: record.updated_at, pinned: false }),
      now,
    ).map((group) => ({
      label: group.label,
      items: group.items.map(presentSessionAssignment),
    }));
  }, [assignments.data, now]);

  const openCompose = (kind: SessionAssignmentChildBehavior) => {
    setCompose(kind);
    showSidePanelList(false);
  };

  const canSpawnOrchestrator = canLaunchManagedOrchestrator(behavior);
  const listToolbar = enabled ? (
    <div className="flex flex-col gap-1 border-b border-muted px-3 py-2 shrink-0">
      <TabButton
        type="button"
        size={TabButtonSize.Medium}
        active={compose === "direct"}
        aria-pressed={compose === "direct"}
        onClick={() => openCompose("direct")}
      >
        <Icon iconName={IconName.Add} size={16} className="shrink-0" />
        <span className="flex-1 min-w-0 truncate text-left">New Agent</span>
      </TabButton>
      {canSpawnOrchestrator ? (
        <TabButton
          type="button"
          size={TabButtonSize.Medium}
          active={compose === "orchestrator"}
          aria-pressed={compose === "orchestrator"}
          onClick={() => openCompose("orchestrator")}
        >
          <Icon iconName={IconName.Add} size={16} className="shrink-0" />
          <span className="flex-1 min-w-0 truncate text-left">New Orchestrator</span>
        </TabButton>
      ) : null}
    </div>
  ) : null;

  const list = !enabled ? (
    <div className="p-1 label-micro text-basic-muted">
      Orchestrator sessions do not own delegated work.
    </div>
  ) : assignments.isPending ? (
    <div role="status" className="p-1 text-small text-basic-secondary">
      Loading spawn sessions…
    </div>
  ) : assignments.isError ? (
    <QueryError
      label="Spawn sessions"
      retry={() => void assignments.refetch()}
    />
  ) : rows.length === 0 ? (
    <div className="p-1 label-micro text-basic-muted">
      {canSpawnOrchestrator
        ? "None yet. Spawn an Agent or Orchestrator session from this chat."
        : "None yet. Spawn a coding Agent from this chat."}
    </div>
  ) : (
    <div className="flex flex-col gap-8 px-1">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <GroupLabel className="px-2">{group.label}</GroupLabel>
          <div className="flex flex-col gap-1">
            {group.items.map((row) => {
              const sessionType = sessionTypeFromBehavior(
                row.kind === "coding-agent" ? "direct" : "orchestrator",
              );
              return (
                <ChatSessionButton
                  key={`${row.kind}:${row.id}`}
                  title={row.description}
                  badgeLabel={row.typeLabel}
                  sessionType={sessionType}
                  origin={
                    assignmentIsOpen(row.status)
                      ? "delegated-locked"
                      : "delegated"
                  }
                  active={compose == null && row.id === current?.id}
                  running={assignmentIsOpen(row.status)}
                  onClick={() => {
                    setCompose(null);
                    onSelect(row.id);
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  if (!enabled) {
    return (
      <PanelSplit listTitle={SESSION_PANEL_LABEL.delegated} list={list}>
        <PanelEmpty>
          Orchestrator sessions do not own delegated work.
        </PanelEmpty>
      </PanelSplit>
    );
  }

  if (assignments.isPending && !assignments.data) {
    return <PanelLoading listTitle={SESSION_PANEL_LABEL.delegated} />;
  }

  return (
    <PanelSplit
      listTitle={SESSION_PANEL_LABEL.delegated}
      listToolbar={listToolbar}
      list={list}
    >
      {compose ? (
        <SpawnComposeForm
          parentSessionId={sessionId}
          behavior={compose}
          onStarted={(childSessionId) => {
            setCompose(null);
            onSelect(childSessionId);
          }}
        />
      ) : current ? (
        <ChildTranscriptPreview
          parentSessionId={sessionId}
          childSessionId={current.id}
        />
      ) : (
        <PanelEmpty title="No spawn sessions yet.">
          {canSpawnOrchestrator
            ? "They appear here as the agent starts them, or start one with New Agent or New Orchestrator."
            : "They appear here as the agent starts them, or start one with New Agent."}
        </PanelEmpty>
      )}
    </PanelSplit>
  );
}
