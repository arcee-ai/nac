import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CodeChangesBadge,
  Icon,
  IconName,
  PopoverPlacement,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { BranchPicker } from "@/app/components/inspector/BranchPicker";
import { RevisionPicker } from "@/app/components/inspector/RevisionPicker";
import { SessionUsage } from "@/app/components/inspector/SessionUsage";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { resolveCatalogModel } from "@/app/lib/catalog";
import { routes } from "@/app/lib/routes";
import { cn } from "@/app/lib/cn";
import {
  formatCostMicros,
  formatTokensCompact,
  runMetrics,
  sessionEnvLabel,
  tokenUsage,
} from "@/app/lib/format";
import {
  useModelCatalog,
  useVisibleSessions,
  useWorkspaceRevisionChanges,
} from "@/app/services/queries";

import type {
  ManagedSessionSummary,
  SessionBehavior,
  SessionSnapshotResponse,
} from "@/app/types/api";

const BEHAVIOR_BADGE: Record<SessionBehavior, string> = {
  direct: "Agent",
  "direct-with-orchestrator": "Agent + NAC",
  orchestrator: "Orchestrator",
};

/**
 * How much of the catalog's window the context fills, or null while either
 * figure is unknown. A model the catalog does not know is measured against its
 * provider's default window, and the reading says so.
 */
function contextShare(
  used: number | null,
  resolved: ReturnType<typeof resolveCatalogModel>,
): string | null {
  const window = resolved.contextWindow;
  if (!window || used == null) return null;
  const share = `${Math.round((used / window) * 100)}%`;
  if (resolved.estimated) {
    return `${share} of ${resolved.provider?.id ?? "the provider"}'s default window. The catalog does not know this model, so the limit is an estimate.`;
  }
  return `${share} of the model's context window`;
}

/**
 * The single-session bar above the transcript: the title with its behavior or
 * parent, the usage readings behind one button, then the checkout the chat is
 * working in.
 */
export function TopSingleSessionHeader({
  sessionId,
  snapshot,
  entry,
  onShowPanel,
}: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  entry: ManagedSessionSummary | null;
  /** Restores the side panel while it is slid away. */
  onShowPanel?: () => void;
}) {
  const {
    useSessionSpend,
    useRunning,
    useRunUsage,
    useRunStartedAt,
    useLastElapsedMs,
    useCancelArmed,
    liftSessionSpend,
  } = useNativeRuntime().stores.runtimeStore;

  const { useSelectedRevision, selectRevision } = useNativeRuntime().stores.sessionLayoutStore;

  const navigate = useNavigate();
  const sessionTitle = useSessionTitle();
  const { data: sessions = [] } = useVisibleSessions();
  const running = useRunning(sessionId);
  const stopping = useCancelArmed(sessionId);
  const runUsage = useRunUsage();
  const sessionSpend = useSessionSpend();
  useEffect(() => {
    liftSessionSpend(tokenUsage(snapshot));
  }, [liftSessionSpend, snapshot]);
  const metrics = runMetrics(snapshot, entry, running || stopping ? runUsage : null, sessionSpend);
  const catalog = useModelCatalog();
  const persistedUsage = tokenUsage(snapshot);
  const contextTokens = metrics.usage?.total_tokens || persistedUsage?.total_tokens || null;
  const runStartedAt = useRunStartedAt();
  const lastElapsedMs = useLastElapsedMs();

  const selectedRevision = useSelectedRevision();
  const changes = useWorkspaceRevisionChanges(sessionId, selectedRevision);
  const workspace = snapshot?.workspace ?? null;
  const totals =
    selectedRevision == null
      ? workspace
      : (changes.data ?? { total_additions: 0, total_deletions: 0 });
  const additions = totals?.total_additions ?? 0;
  const deletions = totals?.total_deletions ?? 0;
  const repo = workspace?.repo_label ?? workspace?.workspace_display ?? null;
  const branch = workspace?.branch ?? null;
  const lineage = entry?.lineage ?? snapshot?.lineage ?? null;
  const readOnly = lineage != null;
  const relationship =
    lineage?.kind === "traditional-child"
      ? "Traditional coding agent"
      : lineage?.kind === "managed-orchestrator"
        ? "Managed NAC orchestrator"
        : null;
  const parent = lineage
    ? sessions.find((item) => item.summary.session_id === lineage.parent_session_id)
    : undefined;
  const parentTitle = parent ? sessionTitle(parent.summary) : "Parent session";
  const openParent = () => {
    if (lineage) navigate(routes.session(lineage.parent_session_id, "delegated"));
  };
  const policy = useUiPolicy();
  const behavior = entry?.summary.behavior ?? snapshot?.metadata.behavior ?? null;
  const badge =
    relationship ?? (behavior && policy.orchestrationEnabled ? BEHAVIOR_BADGE[behavior] : null);
  const title = sessionTitle(entry?.summary);

  return (
    // Wider than its column by the column's own inset, so the rule under it
    // runs from the sidebar to the side panel the way the design draws it.
    <div className="pointer-events-none absolute -inset-x-2 top-0 z-20 flex flex-col border-b border-muted bg-elevation-ground px-4 pt-4 pb-[15px]">
      <div className="pointer-events-auto flex w-full flex-col gap-1.5">
        <div className="flex w-full items-center gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {lineage ? (
              <>
                <Button
                  variant={ButtonVariant.Tertiary}
                  size={ButtonSize.Medium}
                  className="min-w-0 max-w-[120px]"
                  aria-label={`${parentTitle}, parent chat`}
                  title={parentTitle}
                  onClick={openParent}
                >
                  <span className="truncate underline">{parentTitle}</span>
                </Button>
                <Icon iconName={IconName.Right} size={16} className="shrink-0 text-btn-secondary" />
              </>
            ) : null}
            <div className="flex min-w-0 items-center gap-2">
              <p
                className={cn(
                  "header-sm min-w-0 truncate",
                  running ? "text-shimmer-basic" : "text-basic-primary",
                )}
              >
                {title}
              </p>
              {badge ? (
                <span className="tag-label inline-flex shrink-0 items-center rounded-full border border-tertiary bg-elevation-sublevel-variant-B px-2 py-[3px] text-basic-tertiary">
                  {badge}
                </span>
              ) : null}
            </div>
          </div>
          <SessionUsage
            context={formatTokensCompact(contextTokens)}
            contextShare={contextShare(
              contextTokens,
              resolveCatalogModel(catalog.data, snapshot?.metadata?.backend, metrics.model),
            )}
            input={formatTokensCompact(metrics.usage?.input_tokens)}
            output={formatTokensCompact(metrics.usage?.output_tokens)}
            cost={formatCostMicros(metrics.usage?.cost?.total)}
            running={running}
            startedAt={runStartedAt}
            lastElapsedMs={lastElapsedMs ?? metrics.lastResponseMs}
          />
          {onShowPanel ? (
            <Tooltip title="Show panel" position={TooltipPosition.BottomLeft}>
              <Button
                size={ButtonSize.Medium}
                variant={ButtonVariant.Ghost}
                content={ButtonContent.Icon}
                aria-label="Show panel"
                onClick={onShowPanel}
              >
                <Icon iconName={IconName.SidebarChevronLeft} />
              </Button>
            </Tooltip>
          ) : null}
        </div>
        {/* Clipped sideways only: the buttons are as tall as the row, and
            their focus rings reach past it. */}
        <div className="flex w-full min-w-0 items-center gap-4 overflow-x-clip">
          {repo ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <span className="label-micro max-w-[120px] truncate text-basic-tertiary">{repo}</span>
              <span className="tag-label text-basic-muted">{sessionEnvLabel(entry?.summary)}</span>
            </div>
          ) : null}
          {branch && !readOnly ? (
            <BranchPicker
              sessionId={sessionId}
              branch={branch}
              placement={PopoverPlacement.BottomRight}
              tertiary
            />
          ) : null}
          {branch && readOnly ? (
            <span className="label-micro flex min-w-0 items-center gap-1.5 text-btn-secondary">
              <Icon iconName={IconName.Scheme} size={16} className="shrink-0" />
              <span className="truncate">{branch}</span>
            </span>
          ) : null}
          <RevisionPicker
            sessionId={sessionId}
            selected={selectedRevision}
            onSelect={selectRevision}
            placement={PopoverPlacement.BottomRight}
          />
          {additions || deletions ? (
            <CodeChangesBadge additions={additions} deletions={deletions} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
