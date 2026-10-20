import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useMemo, useState } from "react";

import { Button, ButtonSize, ButtonVariant, ChatSessionButton, Icon, IconName } from "@/app/atoms";
import { SubagentComposer } from "@/app/components/inspector/SubagentComposer";
import { SubagentPreview } from "@/app/components/inspector/SubagentPreview";
import { PanelSplit } from "@/app/components/inspector/PanelSplit";
import { useNow } from "@/app/hooks/useNow";
import { groupByRecency } from "@/app/lib/projects";

import { useManagedOrchestrators, useTraditionalChildren } from "@/app/services/queries";
import type {
  ManagedOrchestratorRecord,
  SessionBehavior,
  TraditionalChildRecord,
  TraditionalChildStatus,
} from "@/app/types/api";

interface SubagentRow {
  key: string;
  mode: "child" | "orchestrator";
  id: string;
  description: string;
  status: TraditionalChildStatus;
  background: boolean;
  updatedAt: string;
  fallbackText: string | null;
  icon: IconName;
}

function nonempty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function rowFromChild(child: TraditionalChildRecord): SubagentRow {
  return {
    key: `child:${child.child_session_id}`,
    mode: "child",
    id: child.child_session_id,
    description: child.description,
    status: child.status,
    background: child.execution_mode !== "foreground",
    updatedAt: child.updated_at,
    fallbackText:
      nonempty(child.failure) ??
      nonempty(child.report) ??
      nonempty(child.change_summary) ??
      nonempty(child.verification_summary),
    icon: IconName.Plane,
  };
}

function rowFromOrchestrator(orchestrator: ManagedOrchestratorRecord): SubagentRow {
  return {
    key: `orchestrator:${orchestrator.orchestrator_session_id}`,
    mode: "orchestrator",
    id: orchestrator.orchestrator_session_id,
    description: orchestrator.description,
    status: orchestrator.status,
    background: orchestrator.execution_mode !== "foreground",
    updatedAt: orchestrator.updated_at,
    fallbackText: nonempty(orchestrator.failure) ?? nonempty(orchestrator.report),
    icon: IconName.Orchestrator,
  };
}

/** Subagents are started by the agent; the panel only shows and manages them. */
function NoSubagents() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
      <Icon iconName={IconName.Plane} size={32} className="text-basic-primary" />
      <p className="label-big mt-2 text-center text-basic-primary">No subagents yet</p>
      <p className="label-small mt-2 max-w-[311px] text-center text-basic-tertiary">
        Ask the agent to delegate work. Subagents it starts appear here, where you can browse,
        steer, continue, and cancel them.
      </p>
    </div>
  );
}

export function DelegatedWorkView({
  sessionId,
  behavior,
}: {
  sessionId: string;
  behavior: SessionBehavior;
}) {
  const { showSidePanelList } = useNativeRuntime().stores.sessionLayoutStore;

  const supportsOrchestrators =
    useUiPolicy().orchestrationEnabled && behavior === "direct-with-orchestrator";
  const children = useTraditionalChildren(sessionId, true);
  const orchestrators = useManagedOrchestrators(sessionId, supportsOrchestrators);
  const now = useNow(60_000);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [seenSession, setSeenSession] = useState(sessionId);
  if (seenSession !== sessionId) {
    setSeenSession(sessionId);
    setSelectedKey(null);
  }

  const rows = useMemo(() => {
    const childRows = (children.data ?? []).map(rowFromChild);
    const orchestratorRows = supportsOrchestrators
      ? (orchestrators.data ?? []).map(rowFromOrchestrator)
      : [];
    return [...childRows, ...orchestratorRows];
  }, [children.data, orchestrators.data, supportsOrchestrators]);

  const newestKey =
    [...rows].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.key ?? null;
  if (!supportsOrchestrators && selectedKey?.startsWith("orchestrator:")) setSelectedKey(null);
  if (selectedKey == null && newestKey != null) setSelectedKey(newestKey);

  const selected =
    rows.find((row) => row.key === selectedKey) ??
    rows.find((row) => row.key === newestKey) ??
    null;
  const groups = useMemo(
    () => groupByRecency(rows, (row) => ({ updatedAt: row.updatedAt, pinned: false }), now),
    [rows, now],
  );

  const chooseRow = (key: string) => {
    setSelectedKey(key);
    showSidePanelList(false);
  };

  // A failed poll keeps the last successful payload. Only an empty failure
  // replaces the list; otherwise the rows would vanish on a dropped refetch.
  const failed =
    rows.length === 0 && (children.isError || (supportsOrchestrators && orchestrators.isError));
  const list = failed ? (
    <div role="alert" className="rounded-[6px] border border-error-primary p-3">
      <div className="text-small text-error-primary">Subagents could not be loaded.</div>
      <Button
        className="mt-2"
        size={ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        onClick={() => {
          void children.refetch();
          if (supportsOrchestrators) void orchestrators.refetch();
        }}
      >
        Try again
      </Button>
    </div>
  ) : (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2 px-2">
            <span className="tag-label shrink-0 text-basic-muted">{group.label}</span>
            <span className="h-px min-w-0 flex-1 bg-divider-muted" />
          </div>
          <div className="flex flex-col gap-1">
            {group.items.map((row) => (
              <ChatSessionButton
                key={row.key}
                title={row.description}
                icon={row.icon}
                running={row.status === "running"}
                active={selected?.key === row.key}
                onClick={() => chooseRow(row.key)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <PanelSplit listTitle="Subagents" title={selected?.description} list={list}>
      <div className="flex min-h-0 flex-1 flex-col">
        {selected ? (
          <>
            <SubagentPreview
              sessionId={selected.id}
              title={selected.description}
              fallbackText={selected.fallbackText}
              icon={selected.icon}
            />
            <div className="shrink-0 p-2">
              <SubagentComposer
                key={`${selected.mode}:${selected.id}:${selected.status}`}
                parentSessionId={sessionId}
                target={selected}
                permissionSessionId={selected.id}
                permissionBehavior={selected.mode === "orchestrator" ? "orchestrator" : "direct"}
                showPermissions={false}
              />
            </div>
          </>
        ) : (
          <NoSubagents />
        )}
      </div>
    </PanelSplit>
  );
}
