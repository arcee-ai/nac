import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useSessionBehaviorIconVisible } from "@/app/features/ui-policy/useSessionBehaviorIconVisible";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  ChatSessionButton,
  Icon,
  IconName,
  StickyButton,
} from "@/app/atoms";
import { SubagentComposer } from "@/app/components/inspector/SubagentComposer";
import { SubagentRowActions } from "@/app/components/inspector/SubagentListControls";
import { SubagentPreview } from "@/app/components/inspector/SubagentPreview";
import { PanelEmptyState } from "@/app/components/inspector/PanelMessages";
import { PanelSplit } from "@/app/components/inspector/PanelSplit";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { usePanelListMarksOpen } from "@/app/hooks/usePanelListMarksOpen";
import { useNow } from "@/app/hooks/useNow";
import { cn } from "@/app/lib/cn";
import { groupByRecency } from "@/app/lib/projects";
import { routes } from "@/app/lib/routes";
import { sessionBehaviorIcon } from "@/app/lib/sessionBehavior";
import {
  useManagedOrchestrators,
  useSessions,
  useTraditionalChildren,
} from "@/app/services/queries";
import type {
  ManagedOrchestratorRecord,
  SessionBehavior,
  SessionLineage,
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
}

const MODE_LINEAGE = {
  child: "traditional-child",
  orchestrator: "managed-orchestrator",
} as const satisfies Record<SubagentRow["mode"], SessionLineage["kind"]>;

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
  };
}

export function DelegatedWorkView({
  sessionId,
  behavior,
}: {
  sessionId: string;
  behavior: SessionBehavior;
}) {
  const {
    showSidePanelList,
    selectSubagent,
    useSelectedSubagent,
    useSidePanelExpanded,
    toggleSidePanelExpanded,
  } = useNativeRuntime().stores.sessionLayoutStore;
  // Below the desktop width the list and the detail are never both on screen.
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const narrow = isMobile || isTablet;
  const marksOpen = usePanelListMarksOpen();

  const navigate = useNavigate();
  const expanded = useSidePanelExpanded();
  const supportsOrchestrators =
    useUiPolicy().orchestrationEnabled && behavior === "direct-with-orchestrator";
  const showBehaviorIcon = useSessionBehaviorIconVisible();
  const children = useTraditionalChildren(sessionId, true);
  const orchestrators = useManagedOrchestrators(sessionId, supportsOrchestrators);
  const sessions = useSessions();
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

  // The composer floats over the preview, whose run-out under the last
  // message has to clear it however tall it grows.
  const [detailColumn, setDetailColumn] = useState<HTMLDivElement | null>(null);
  const [composerLayer, setComposerLayer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!detailColumn || !composerLayer || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      detailColumn.style.setProperty("--composer-height", `${composerLayer.offsetHeight}px`);
    });
    observer.observe(composerLayer);
    return () => observer.disconnect();
  }, [detailColumn, composerLayer]);

  // A delegated session is in the session list too, with the name and pin given
  // to it there.
  const summaries = useMemo(
    () => new Map((sessions.data ?? []).map((entry) => [entry.summary.session_id, entry.summary])),
    [sessions.data],
  );
  const rowTitle = (row: SubagentRow) => nonempty(summaries.get(row.id)?.title) ?? row.description;

  const groups = useMemo(
    () =>
      groupByRecency(
        rows,
        (row) => ({
          updatedAt: row.updatedAt,
          pinned: Boolean(summaries.get(row.id)?.pinned),
        }),
        now,
      ),
    [rows, summaries, now],
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
  // Subagents are started by the agent; the panel only shows and manages them.
  if (loaded && rows.length === 0) {
    return (
      <PanelEmptyState
        listTitle="Subagents"
        title="No subagents yet"
        description="Subagents will appear here once the agent decides to spawn them."
      />
    );
  }
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
          {/* `.badge` is Figma's Tag-label type; the shared `.tag-label` is
              semibold and tracked. */}
          <span className={cn("badge text-basic-muted", isMobile ? "px-3" : "px-2")}>
            {group.label}
          </span>
          <div className="flex flex-col gap-1">
            {group.items.map((row) => {
              const title = rowTitle(row);
              const summary = summaries.get(row.id);
              return (
                <ChatSessionButton
                  key={row.key}
                  title={title}
                  lineage={MODE_LINEAGE[row.mode]}
                  showBehaviorIcon={showBehaviorIcon}
                  running={row.status === "running"}
                  active={marksOpen && selected?.key === row.key}
                  isMobile={isMobile}
                  smallTitle
                  onClick={() => chooseRow(row.key)}
                  actions={
                    summary ? (
                      <SubagentRowActions summary={summary} title={title} isMobile={isMobile} />
                    ) : null
                  }
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  const openDetail = (id: string) => {
    // The expanded side box outlives route changes and would cover the chat
    // opened, on a phone and on a wider screen alike.
    if (expanded) toggleSidePanelExpanded();
    navigate(routes.session(id));
  };
  const openButton = !selected ? null : isMobile ? (
    <StickyButton
      variant={ButtonVariant.Ghost}
      content={ButtonContent.IconRight}
      aria-label="Open"
      onClick={() => openDetail(selected.id)}
    >
      Open
      <Icon iconName={IconName.External} />
    </StickyButton>
  ) : isTablet ? (
    <Button
      size={ButtonSize.Small}
      variant={ButtonVariant.Ghost}
      content={ButtonContent.IconRight}
      aria-label="Open"
      onClick={() => openDetail(selected.id)}
    >
      Open
      <Icon iconName={IconName.External} />
    </Button>
  ) : null;

  return (
    <PanelSplit
      listTitle="Subagents"
      title={
        selected ? (
          <span
            className={cn(
              isTablet && "font-medium",
              selected.status === "running" && "text-shimmer-basic",
            )}
          >
            {rowTitle(selected)}
          </span>
        ) : undefined
      }
      actions={openButton}
      listClassName="px-1 py-6"
      list={
        isMobile ? (
          <div className="pt-6">{list}</div>
        ) : isTablet ? (
          // The desktop column's insets, out of the tablet list's own 8px.
          <div className="-mx-1 -mt-2 py-6">{list}</div>
        ) : (
          list
        )
      }
    >
      <div ref={setDetailColumn} className="relative flex min-h-0 flex-1 flex-col">
        {selected ? (
          <>
            <SubagentPreview
              sessionId={selected.id}
              title={rowTitle(selected)}
              fallbackText={selected.fallbackText}
              icon={sessionBehaviorIcon(null, MODE_LINEAGE[selected.mode])}
              header={!narrow}
              onOpen={() => openDetail(selected.id)}
            />
            <div ref={setComposerLayer} className="pointer-events-none absolute inset-x-0 bottom-0">
              <SubagentComposer
                key={`${selected.mode}:${selected.id}`}
                parentSessionId={sessionId}
                target={selected}
                permissionSessionId={selected.id}
                permissionBehavior={selected.mode === "orchestrator" ? "orchestrator" : "direct"}
                showPermissions={false}
                floating
              />
            </div>
          </>
        ) : narrow ? (
          listState
        ) : null}
      </div>
    </PanelSplit>
  );
}
