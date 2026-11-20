import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import SessionNameDisclosure from "@/app/atoms/session-name-disclosure";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  StickyButton,
} from "@/app/atoms";
import { SubagentComposer } from "@/app/components/inspector/SubagentComposer";
import { SubagentListRow } from "@/app/features/delegation/presentation/SubagentListRow";
import {
  compactAge,
  subagentStateLine,
} from "@/app/features/delegation/presentation/subagentRowModel";
import { SubagentRowActions } from "@/app/components/inspector/SubagentListControls";
import { SubagentPreview } from "@/app/components/inspector/SubagentPreview";
import { FoldChoicesContext } from "@/app/components/inspector/transcript/foldChoices";
import { PanelEmptyState } from "@/app/components/inspector/PanelMessages";
import { PanelSplit } from "@/app/components/inspector/PanelSplit";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { usePanelListMarksOpen } from "@/app/hooks/usePanelListMarksOpen";
import { useNow } from "@/app/hooks/useNow";
import { cn } from "@/app/lib/cn";
import { routes } from "@/app/lib/routes";
import { useSessions, useTraditionalChildren } from "@/app/services/queries";
import type {
  SessionBehavior,
  TraditionalChildRecord,
  TraditionalChildStatus,
} from "@/app/types/api";

interface SubagentRow {
  key: string;
  mode: "child";
  id: string;
  description: string;
  status: TraditionalChildStatus;
  generation: number;
  runId: string | null;
  background: boolean;
  updatedAt: string;
  fallbackText: string | null;
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
    generation: child.generation,
    runId: child.run_id ?? null,
    background: child.execution_mode !== "foreground",
    updatedAt: child.updated_at,
    fallbackText:
      nonempty(child.failure) ??
      nonempty(child.report) ??
      nonempty(child.change_summary) ??
      nonempty(child.verification_summary),
  };
}

export function DelegatedWorkView({ sessionId }: { sessionId: string; behavior: SessionBehavior }) {
  const {
    showSidePanelList,
    selectSubagent,
    useSelectedSubagent,
    useSidePanelExpanded,
    toggleSidePanelExpanded,
    rememberSubagentPage,
  } = useNativeRuntime().stores.sessionLayoutStore;
  // Below the desktop width the list and the detail are never both on screen.
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const narrow = isMobile || isTablet;
  const marksOpen = usePanelListMarksOpen();

  const navigate = useNavigate();
  const expanded = useSidePanelExpanded();
  const children = useTraditionalChildren(sessionId, true);
  const sessions = useSessions();
  const now = useNow(60_000);
  const selectedKey = useSelectedSubagent(sessionId);
  const [foldChoices] = useState(() => new Map<string, boolean>());

  const rows = useMemo(() => (children.data ?? []).map(rowFromChild), [children.data]);

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

  const failed = children.isError;
  const loaded = children.isSuccess;
  const groups = useMemo(() => {
    const ordered = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const active = ordered.filter((row) => row.status === "running");
    const finished = ordered.filter((row) => row.status !== "running" && row.status !== "idle");
    const idle = ordered.filter((row) => row.status === "idle");
    return [
      { label: loaded && !failed ? `Active (${active.length})` : "Active", items: active },
      { label: "Finished", items: finished },
      { label: "Idle", items: idle },
    ].filter((group, index) => index === 0 || group.items.length > 0);
  }, [rows, loaded, failed]);

  const chooseRow = (key: string) => {
    selectSubagent(sessionId, key);
    showSidePanelList(false);
  };

  // "None yet" is only true once every list the panel shows has answered.
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
    <div role="alert" className="flex flex-col items-start gap-2 px-2.5 py-3">
      <p className="type-body-chrome text-error-primary">
        {rows.length
          ? "Some subagents could not be loaded. Showing available agents."
          : "Subagents could not be loaded."}
      </p>
      <Button
        className="max-md:!min-h-11 max-md:!min-w-11"
        size={ButtonSize.Small}
        variant={ButtonVariant.Secondary}
        onClick={() => {
          void children.refetch();
        }}
      >
        Try again
      </Button>
    </div>
  );
  // In the list too, so a narrow list opened over a failed load still offers the retry.
  const listState = failed ? (
    loadError
  ) : !loaded ? (
    <p role="status" className="type-body-chrome m-auto px-2.5 py-3 text-basic-tertiary">
      {rows.length ? "Loading remaining subagents…" : "Loading subagents…"}
    </p>
  ) : null;
  const list = (
    <div className="flex flex-col gap-5">
      {listState}
      <span className="type-meta px-2.5 text-basic-tertiary">Agents in this chat</span>
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <span className={cn("type-meta text-basic-muted pb-1", isMobile ? "px-3" : "px-2.5")}>
            {group.label}
          </span>
          {group.items.map((row) => {
            const title = rowTitle(row);
            const summary = summaries.get(row.id);
            return (
              <SubagentListRow
                key={row.key}
                title={title}
                status={row.status}
                stateLine={subagentStateLine({
                  status: row.status,
                  orchestrator: false,
                  background: row.background,
                  detail: row.fallbackText,
                })}
                age={compactAge(row.updatedAt, now)}
                active={marksOpen && selected?.key === row.key}
                isMobile={isMobile}
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
      ))}
    </div>
  );

  const openDetail = (id: string) => {
    if (selected) selectSubagent(sessionId, selected.key);
    rememberSubagentPage(sessionId, id);
    // The expanded side box outlives route changes and would cover the chat
    // opened, on a phone and on a wider screen alike.
    if (expanded) toggleSidePanelExpanded();
    navigate(routes.session(id));
  };
  const openButton = !selected ? null : isMobile ? (
    <StickyButton
      className="!h-11"
      buttonClassName="!h-11"
      variant={ButtonVariant.Ghost}
      content={ButtonContent.IconRight}
      aria-label="Open"
      aria-description="Open this child’s own Insights and Files"
      onClick={() => openDetail(selected.id)}
    >
      Open
      <Icon iconName={IconName.External} />
    </StickyButton>
  ) : isTablet ? (
    <Button
      className="!min-h-11"
      size={ButtonSize.Small}
      variant={ButtonVariant.Ghost}
      content={ButtonContent.IconRight}
      aria-label="Open"
      aria-description="Open this child’s own Insights and Files"
      onClick={() => openDetail(selected.id)}
    >
      Open session
      <Icon iconName={IconName.External} />
    </Button>
  ) : null;

  return (
    <PanelSplit
      phoneHeaderInFlow={isMobile}
      listTitle="Subagents"
      title={
        selected ? (
          <SessionNameDisclosure
            name={rowTitle(selected)}
            running={selected.status === "running"}
            className={cn(
              "min-w-0 max-w-full",
              isMobile && "min-h-11 min-w-11",
              isTablet && "font-medium",
            )}
          />
        ) : undefined
      }
      actions={openButton}
      listClassName="px-1.5 py-3"
      list={
        isMobile ? (
          <div className="pt-3">{list}</div>
        ) : isTablet ? (
          // The desktop column's insets, out of the tablet list's own 8px.
          <div className="-mx-0.5 -mt-1 py-3">{list}</div>
        ) : (
          list
        )
      }
    >
      <div ref={setDetailColumn} className="relative flex min-h-0 flex-1 flex-col">
        {selected ? (
          <>
            <FoldChoicesContext value={foldChoices}>
              <SubagentPreview
                key={selected.key}
                sessionId={selected.id}
                title={rowTitle(selected)}
                fallbackText={selected.fallbackText}
                relationship={selected}
                header={!narrow}
                phoneHeaderInFlow={isMobile}
                onOpen={() => openDetail(selected.id)}
              />
            </FoldChoicesContext>
            <div ref={setComposerLayer} className="pointer-events-none absolute inset-x-0 bottom-0">
              <SubagentComposer
                key={`${selected.mode}:${selected.id}`}
                parentSessionId={sessionId}
                target={selected}
                permissionSessionId={selected.id}
                permissionBehavior="direct"
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
