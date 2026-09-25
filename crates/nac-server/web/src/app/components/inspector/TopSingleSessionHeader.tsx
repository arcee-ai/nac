import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  PopoverPlacement,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { BranchPicker } from "@/app/components/inspector/BranchPicker";
import { RevisionPicker } from "@/app/components/inspector/RevisionPicker";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { useNow } from "@/app/hooks/useNow";
import { resolveCatalogModel } from "@/app/lib/catalog";
import { routes } from "@/app/lib/routes";
import { cn } from "@/app/lib/cn";
import {
  formatClock,
  formatCostMicros,
  formatTokensCompact,
  runMetrics,
  sessionEnvLabel,
  tokenUsage,
} from "@/app/lib/format";
import { useModelCatalog, useSessions, useWorkspaceRevisionChanges } from "@/app/services/queries";
import { selectRevision, useSelectedRevision } from "@/app/store/sessionLayoutStore";
import {
  liftSessionSpend,
  useCancelArmed,
  useLastElapsedMs,
  useRunStartedAt,
  useRunUsage,
  useRunning,
  useSessionSpend,
} from "@/app/store/runtimeStore";
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
 * Context reading against the catalog's window. The figure on the chip stays
 * the live total; the window only appears in the hover, the way the composer
 * explains the same number.
 */
function contextTitle(
  used: number | null,
  resolved: ReturnType<typeof resolveCatalogModel>,
): string {
  const window = resolved.contextWindow;
  if (!window || used == null) return "Context tokens";
  if (resolved.estimated) {
    return `Context against ${resolved.provider?.id ?? "the provider"}'s default window — the catalog does not know this model, so the limit is an estimate`;
  }
  return `Context — ${Math.round((used / window) * 100)}% of the model's context window`;
}

function Metric({
  iconName,
  value,
  title,
  className,
  labelClassName,
}: {
  iconName: IconName;
  value: string;
  title: string;
  className?: string;
  labelClassName: string;
}) {
  return (
    <Tooltip title={title} position={TooltipPosition.BottomCenter}>
      <div className={cn("flex items-center gap-0.5 whitespace-nowrap", className)}>
        <Icon iconName={iconName} size={14} />
        <span className={labelClassName}>{value}</span>
      </div>
    </Tooltip>
  );
}

/**
 * The single-session bar above the transcript: title and behavior, the live
 * token and cost reading, then the checkout the chat is working in.
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
  const navigate = useNavigate();
  const sessionTitle = useSessionTitle();
  const { data: sessions = [] } = useSessions();
  const running = useRunning(sessionId);
  const stopping = useCancelArmed(sessionId);
  const runUsage = useRunUsage();
  const sessionSpend = useSessionSpend();
  useEffect(() => {
    liftSessionSpend(tokenUsage(snapshot));
  }, [snapshot]);
  const metrics = runMetrics(snapshot, entry, running || stopping ? runUsage : null, sessionSpend);
  const catalog = useModelCatalog();
  const persistedUsage = tokenUsage(snapshot);
  const contextTokens = metrics.usage?.total_tokens || persistedUsage?.total_tokens || null;
  const context = contextTitle(
    contextTokens,
    resolveCatalogModel(catalog.data, snapshot?.metadata?.backend, metrics.model),
  );
  const now = useNow(1000, running);
  const runStartedAt = useRunStartedAt();
  const lastElapsedMs = useLastElapsedMs();
  const liveElapsed = running && runStartedAt != null ? Math.max(0, now - runStartedAt) : null;
  const elapsedMs = liveElapsed ?? lastElapsedMs ?? metrics.lastResponseMs;

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
  const parent = lineage
    ? sessions.find((item) => item.summary.session_id === lineage.parent_session_id)
    : undefined;
  const parentTitle = parent ? sessionTitle(parent.summary) : "Parent session";
  const openParent = () => {
    if (lineage) navigate(routes.session(lineage.parent_session_id));
  };
  const behavior = entry?.summary.behavior ?? snapshot?.metadata.behavior ?? null;
  const title = sessionTitle(entry?.summary);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col justify-center px-4 py-2 bg-elevation-ground">
      <div className="pointer-events-auto flex w-full flex-col">
        <div className="flex w-full items-center gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {lineage ? (
              <>
                <Button
                  size={ButtonSize.Large}
                  variant={ButtonVariant.Ghost}
                  content={ButtonContent.Icon}
                  className="!h-6 !w-6 !min-h-0 !p-0"
                  aria-label={`Back to ${parentTitle}`}
                  onClick={openParent}
                >
                  <Icon iconName={IconName.Left} />
                </Button>
                <button
                  type="button"
                  className="label-medium max-w-[120px] truncate text-btn-secondary"
                  title={parentTitle}
                  onClick={openParent}
                >
                  {parentTitle}
                </button>
                <Icon iconName={IconName.Right} size={16} className="shrink-0 text-btn-secondary" />
              </>
            ) : null}
            <p
              className={cn(
                "header-md min-w-0 truncate",
                running ? "text-shimmer-basic" : "text-basic-primary",
              )}
            >
              {title}
            </p>
            {behavior ? (
              <span className="tag-label inline-flex shrink-0 items-center rounded-full border border-tertiary bg-elevation-sublevel-variant-B px-1 py-[2px] text-basic-tertiary">
                {BEHAVIOR_BADGE[behavior]}
              </span>
            ) : null}
          </div>
          {metrics.usage || contextTokens ? (
            <div className="shrink-0 items-center gap-0.5 hidden xl:flex">
              <Metric
                iconName={IconName.Timelaps}
                value={formatTokensCompact(contextTokens)}
                title={context}
                className="text-info-primary"
                labelClassName="label-micro"
              />
              {metrics.usage ? (
                <>
                  <Metric
                    iconName={IconName.ArrowTop}
                    value={formatTokensCompact(metrics.usage.input_tokens)}
                    title="Input tokens"
                    className="text-info-secondary opacity-75"
                    labelClassName="text-micro"
                  />
                  <Metric
                    iconName={IconName.ArrowDown}
                    value={formatTokensCompact(metrics.usage.output_tokens)}
                    title="Output tokens"
                    className="text-info-secondary opacity-75"
                    labelClassName="text-micro"
                  />
                </>
              ) : null}
            </div>
          ) : null}
          <div className="flex shrink-0 items-center">
            {metrics.usage ? (
              <Tooltip title="Session cost" position={TooltipPosition.BottomCenter}>
                <span className="text-micro whitespace-nowrap text-basic-primary">
                  {formatCostMicros(metrics.usage.cost?.total)}
                </span>
              </Tooltip>
            ) : null}
            <Tooltip
              title={running ? "Run elapsed" : "Last response time"}
              position={TooltipPosition.BottomRight}
            >
              <span className="label-micro flex h-6 w-14 items-center justify-end text-basic-tertiary">
                {formatClock(elapsedMs)}
              </span>
            </Tooltip>
          </div>
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
        <div className="flex w-full items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
            {repo ? (
              <div className="flex shrink-0 items-center gap-0.5">
                <span className="label-micro max-w-[120px] truncate text-basic-tertiary">
                  {repo}
                </span>
                <span className="tag-label text-basic-muted">
                  {sessionEnvLabel(entry?.summary)}
                </span>
              </div>
            ) : null}
            {branch && !readOnly ? (
              <BranchPicker
                sessionId={sessionId}
                branch={branch}
                placement={PopoverPlacement.BottomRight}
              />
            ) : null}
            {branch && readOnly ? (
              <span className="label-micro flex min-w-0 items-center gap-1.5 text-btn-secondary">
                <Icon iconName={IconName.Scheme} size={16} className="shrink-0" />
                <span className="truncate">{branch}</span>
              </span>
            ) : null}
          </div>
          <RevisionPicker
            sessionId={sessionId}
            selected={selectedRevision}
            onSelect={selectRevision}
            placement={PopoverPlacement.BottomLeft}
          />
          {additions || deletions ? (
            <div className="code code-small flex shrink-0 items-center gap-2">
              <span className="text-success-primary">+{additions}</span>
              <span className="text-error-primary">-{deletions}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
