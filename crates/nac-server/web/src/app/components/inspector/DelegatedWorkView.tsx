import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useEffect, useMemo } from "react";

import { Button, ButtonSize, ButtonVariant, ChatSessionButton, Icon, IconName } from "@/app/atoms";
import { SubagentComposer } from "@/app/components/inspector/SubagentComposer";
import { SubagentPreview } from "@/app/components/inspector/SubagentPreview";
import { PanelSplit } from "@/app/components/inspector/PanelSplit";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
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
  const { showSidePanelList, selectSubagent, useSelectedSubagent } =
    useNativeRuntime().stores.sessionLayoutStore;
  // Below the desktop width the list and the detail are never both on screen.
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const narrow = isMobile || isTablet;

  const supportsOrchestrators =
    useUiPolicy().orchestrationEnabled && behavior === "direct-with-orchestrator";
  const children = useTraditionalChildren(sessionId, true);
  const orchestrators = useManagedOrchestrators(sessionId, supportsOrchestrators);
  const now = useNow(60_000);
  const selectedKey = useSelectedSubagent(sessionId);

  const rows = useMemo(() => {
    const childRows = (children.data ?? []).map(rowFromChild);
    const orchestratorRows = supportsOrchestrators
      ? (orchestrators.data ?? []).map(rowFromOrchestrator)
      : [];
    return [...childRows, ...orchestratorRows];
  }, [children.data, orchestrators.data, supportsOrchestrators]);

  const newestKey =
    [...rows].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.key ?? null;
  // A hidden or vanished choice is kept; the newest row stands in until it returns.
  const selected =
    rows.find((row) => row.key === selectedKey) ??
    rows.find((row) => row.key === newestKey) ??
    null;
  // Pin the first default, so another subagent updating does not move it.
  useEffect(() => {
    if (selectedKey == null && newestKey != null) selectSubagent(sessionId, newestKey);
  }, [newestKey, selectSubagent, selectedKey, sessionId]);
  const groups = useMemo(
    () => groupByRecency(rows, (row) => ({ updatedAt: row.updatedAt, pinned: false }), now),
    [rows, now],
  );

  const chooseRow = (key: string) => {
    selectSubagent(sessionId, key);
    showSidePanelList(false);
  };

  // A failed poll keeps the last successful payload. Only an empty failure
  // replaces the list; otherwise the rows would vanish on a dropped refetch.
  const failed =
    rows.length === 0 && (children.isError || (supportsOrchestrators && orchestrators.isError));
  // "None yet" is only true once every list the panel shows has answered.
  const loaded = children.isSuccess && (!supportsOrchestrators || orchestrators.isSuccess);
  const loadError = (
    <div role="alert" className="m-2 rounded-[6px] border border-error-primary p-3">
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
  );
  // In the list too, so a narrow list opened over a failed load still offers the retry.
  const listState = failed ? (
    loadError
  ) : rows.length === 0 && !loaded ? (
    <p role="status" className="label-small m-auto text-basic-tertiary">
      Loading subagents…
    </p>
  ) : null;
  const list = (
    <div className="flex flex-col gap-8">
      {listState}
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
            {/* A phone's tab bar floats over the bottom of the panel, as for Files and Threads. */}
            <div className="shrink-0 p-2 pb-[104px] md:pb-2">
              <SubagentComposer
                key={`${selected.mode}:${selected.id}`}
                parentSessionId={sessionId}
                target={selected}
                permissionSessionId={selected.id}
                permissionBehavior={selected.mode === "orchestrator" ? "orchestrator" : "direct"}
                showPermissions={false}
              />
            </div>
          </>
        ) : listState ? (
          narrow ? (
            listState
          ) : null
        ) : (
          <NoSubagents />
        )}
      </div>
    </PanelSplit>
  );
}
