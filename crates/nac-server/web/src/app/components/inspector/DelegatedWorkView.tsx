import { useMemo, useState } from "react";

import {
  Button,
  ButtonSize,
  ButtonVariant,
  ChatSessionButton,
  Icon,
  IconName,
  TabButton,
} from "@/app/atoms";
import { SubagentComposer, type SubagentTarget } from "@/app/components/inspector/SubagentComposer";
import { SubagentPreview } from "@/app/components/inspector/SubagentPreview";
import { PanelSplit } from "@/app/components/inspector/PanelSplit";
import { useNow } from "@/app/hooks/useNow";
import { cn } from "@/app/lib/cn";
import { groupByRecency } from "@/app/lib/projects";
import {
  clearSubagentLaunch,
  openSubagentLaunch,
  useSubagentLaunchRequest,
  showSidePanelList,
  useSubagentLaunch,
} from "@/app/store/sessionLayoutStore";
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

function parseRowKey(key: string): { mode: "child" | "orchestrator"; id: string } | null {
  if (key.startsWith("child:")) return { mode: "child", id: key.slice("child:".length) };
  if (key.startsWith("orchestrator:")) {
    return { mode: "orchestrator", id: key.slice("orchestrator:".length) };
  }
  return null;
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

const LAUNCH_COPY = {
  agent: {
    title: "Launch Subagent",
    body: "Start a fresh-context coding agent. Browse, steer, continue, and cancel it from this chat.",
    icon: IconName.Plane,
  },
  orchestrator: {
    title: "Launch Suborchestrator",
    body: "Start a separate NAC planning session. Browse, steer, continue, and cancel it from this chat.",
    icon: IconName.Orchestrator,
  },
} as const;

function LaunchEmpty({ kind }: { kind: "agent" | "orchestrator" }) {
  const copy = LAUNCH_COPY[kind];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
      <Icon iconName={copy.icon} size={32} className="text-basic-primary" />
      <p className="label-big mt-2 text-center text-basic-primary">{copy.title}</p>
      <p className="label-small mt-2 max-w-[311px] text-center text-basic-tertiary">{copy.body}</p>
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
  const supportsOrchestrators = behavior === "direct-with-orchestrator";
  const children = useTraditionalChildren(sessionId, true);
  const orchestrators = useManagedOrchestrators(sessionId, supportsOrchestrators);
  const launch = useSubagentLaunch();
  const launchRequest = useSubagentLaunchRequest();
  const now = useNow(60_000);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const rows = useMemo(() => {
    const childRows = (children.data ?? []).map(rowFromChild);
    const orchestratorRows = supportsOrchestrators
      ? (orchestrators.data ?? []).map(rowFromOrchestrator)
      : [];
    return [...childRows, ...orchestratorRows];
  }, [children.data, orchestrators.data, supportsOrchestrators]);

  const newestKey =
    [...rows].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.key ?? null;
  // Keep a just-launched key even before the children list refetches. Falling
  // back to `newestKey` the moment the id is missing would snap back to the
  // previous row and stay there once the list catches up.
  const resolvedKey = launch ? null : (selectedKey ?? newestKey);
  if (!launch && selectedKey == null && newestKey != null) setSelectedKey(newestKey);

  const selected = rows.find((row) => row.key === resolvedKey) ?? null;
  const pending = !launch && !selected && resolvedKey ? parseRowKey(resolvedKey) : null;
  const groups = useMemo(
    () => groupByRecency(rows, (row) => ({ updatedAt: row.updatedAt, pinned: false }), now),
    [rows, now],
  );

  const chooseLaunch = (kind: "agent" | "orchestrator") => {
    openSubagentLaunch(kind);
    showSidePanelList(false);
  };
  const chooseRow = (key: string) => {
    clearSubagentLaunch();
    setSelectedKey(key);
    showSidePanelList(false);
  };

  const target: SubagentTarget = launch
    ? { mode: launch === "agent" ? "new-agent" : "new-orchestrator" }
    : selected
      ? {
          mode: selected.mode,
          id: selected.id,
          description: selected.description,
          status: selected.status,
          background: selected.background,
        }
      : pending
        ? {
            mode: pending.mode,
            id: pending.id,
            description: "Subagent",
            status: "running",
            background: false,
          }
        : { mode: "new-agent" };

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
                active={!launch && selected?.key === row.key}
                onClick={() => chooseRow(row.key)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <PanelSplit
      listTitle="Subagents"
      title={launch ? LAUNCH_COPY[launch].title : selected?.description}
      listToolbar={
        <div className="flex flex-col gap-1 border-b border-muted p-2">
          <TabButton active={launch === "agent"} onClick={() => chooseLaunch("agent")}>
            <Icon iconName={IconName.Add} />
            <span className="min-w-0 flex-1 truncate text-left">New Agent</span>
          </TabButton>
          {supportsOrchestrators ? (
            <TabButton
              active={launch === "orchestrator"}
              onClick={() => chooseLaunch("orchestrator")}
            >
              <Icon iconName={IconName.Add} />
              <span className="min-w-0 flex-1 truncate text-left">New Orchestrator</span>
            </TabButton>
          ) : null}
        </div>
      }
      list={list}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {launch ? (
          <LaunchEmpty kind={launch} />
        ) : selected ? (
          <SubagentPreview
            sessionId={selected.id}
            title={selected.description}
            fallbackText={selected.fallbackText}
            icon={selected.icon}
          />
        ) : pending ? (
          <SubagentPreview
            sessionId={pending.id}
            title="Subagent"
            fallbackText={null}
            icon={pending.mode === "orchestrator" ? IconName.Orchestrator : IconName.Plane}
          />
        ) : (
          <LaunchEmpty kind="agent" />
        )}
        <div className={cn("shrink-0 p-2")}>
          <SubagentComposer
            key={`${target.mode}:${"id" in target ? target.id : "new"}:${"status" in target ? target.status : ""}`}
            autoFocus={launch != null}
            focusRequest={launchRequest}
            parentSessionId={sessionId}
            target={target}
            permissionSessionId={"id" in target ? target.id : sessionId}
            permissionBehavior={
              target.mode === "orchestrator" || target.mode === "new-orchestrator"
                ? "orchestrator"
                : "direct"
            }
            showPermissions={false}
            onStarted={(id) => {
              clearSubagentLaunch();
              setSelectedKey(
                target.mode === "new-orchestrator" || target.mode === "orchestrator"
                  ? `orchestrator:${id}`
                  : `child:${id}`,
              );
            }}
          />
        </div>
      </div>
    </PanelSplit>
  );
}
