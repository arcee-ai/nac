import { useRef, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  PopoverSize,
  SessionAvatar,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { useSessionNameDisclosure } from "@/app/atoms/session-name-disclosure";
import { compactAge } from "@/app/features/sidebar/relativeTime";
import { Menu, MenuItem, MenuSeparator } from "@/app/features/sidebar/MenuItem";
import { useNow } from "@/app/hooks/useNow";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { cn } from "@/app/lib/cn";
import { formatCostMicros, isActiveRun, sessionEnvLabel } from "@/app/lib/format";
import type { ProjectListItem } from "@/app/lib/projects";
import type { SessionSummarySnapshot } from "@/app/types/api";

/** What a tile shows, flattened from either kind of item. */
interface TileFacts {
  id: string;
  orphan: boolean;
  title: string;
  cwd: string;
  pinned: boolean;
  running: number;
  costMicros: number;
  speedTierChargesExcluded: boolean;
  subscriptionEstimate: boolean;
  sessionCount: number | null;
  updatedAt: string;
  representative: SessionSummarySnapshot | null;
}

function factsFor(
  item: ProjectListItem,
  sessionTitle: (summary: SessionSummarySnapshot) => string,
): TileFacts {
  if (item.kind === "project") {
    const { project, sessions, running, totalCostMicros, updatedAt } = item.entry;
    const live = sessions.find((entry) => isActiveRun(entry.active_run));
    return {
      id: project.project_id,
      orphan: false,
      title: project.name,
      cwd: project.cwd,
      pinned: project.pinned,
      running,
      costMicros: totalCostMicros,
      speedTierChargesExcluded: sessions.some((entry) => entry.summary.speed_tier_charges_excluded),
      subscriptionEstimate: sessions.some(
        (entry) => entry.summary.backend === "chatgpt-codex-responses",
      ),
      sessionCount: sessions.length,
      updatedAt,
      representative: live?.summary ?? sessions[0]?.summary ?? null,
    };
  }
  const { summary, active_run } = item.session;
  return {
    id: summary.session_id,
    orphan: true,
    title: sessionTitle(summary),
    cwd: summary.cwd,
    pinned: false,
    running: isActiveRun(active_run) ? 1 : 0,
    costMicros: summary.total_cost_micros ?? 0,
    speedTierChargesExcluded: Boolean(summary.speed_tier_charges_excluded),
    subscriptionEstimate: summary.backend === "chatgpt-codex-responses",
    sessionCount: null,
    updatedAt: summary.updated_at,
    representative: summary,
  };
}

export type ProjectListKind = "project" | "orphan";

export interface ProjectReorderStart {
  itemId: string;
  kind: ProjectListKind;
  pinned: boolean;
  clientX: number;
  clientY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface ProjectCardReorder {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReorderStart: (start: ProjectReorderStart) => void;
}

/** Fine-pointer drag grip at the tile's left edge. */
function DragHandle({
  getCardElement,
  onReorderStart,
}: {
  getCardElement: () => HTMLElement | null;
  onReorderStart: (start: ProjectReorderStart) => void;
}) {
  return (
    <button
      type="button"
      aria-label="Drag to reorder"
      tabIndex={-1}
      className={cn(
        "absolute top-1/2 left-1 z-[1] flex h-8 w-3 -translate-y-1/2 items-center justify-center gap-[2px]",
        "cursor-grab touch-none rounded-sm opacity-0 transition-opacity duration-150 active:cursor-grabbing",
        "group-hover/tile:opacity-100 [@media(hover:none)]:hidden",
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const card = getCardElement();
        if (!card) return;
        const rect = card.getBoundingClientRect();
        event.currentTarget.setPointerCapture(event.pointerId);
        onReorderStart({
          itemId: card.dataset.itemId ?? "",
          kind: card.dataset.itemKind === "orphan" ? "orphan" : "project",
          pinned: card.dataset.itemPinned === "true",
          clientX: event.clientX,
          clientY: event.clientY,
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
          width: rect.width,
          height: rect.height,
        });
      }}
    >
      <span className="h-4 w-px rounded-[1px] bg-[var(--f-ink-5)]" />
      <span className="h-4 w-px rounded-[1px] bg-[var(--f-ink-5)]" />
    </button>
  );
}

interface ProjectCardProps {
  item: ProjectListItem;
  selected: boolean;
  attention: boolean;
  onOpen: () => void;
  onDelete: () => void;
  /** Project tiles only. */
  onTogglePin?: () => void;
  onRename?: () => void;
  onNewSession?: () => void;
  onIntervalTasks?: () => void;
  /** Unassigned sessions only: file the session under a project. */
  onAssign?: () => void;
  reorder?: ProjectCardReorder;
  /** The tile is the active drag ghost. */
  dragging?: boolean;
}

/**
 * Home's project tile (or an unassigned session's): avatar, name, location,
 * a quiet facts line, and one options menu. Opens with a click or Enter.
 */
export function ProjectCard({
  item,
  selected,
  attention,
  onOpen,
  onDelete,
  onTogglePin,
  onRename,
  onNewSession,
  onIntervalTasks,
  onAssign,
  reorder,
  dragging = false,
}: ProjectCardProps) {
  const sessionTitle = useSessionTitle();
  const facts = factsFor(item, sessionTitle);
  const now = useNow(60_000);
  const [menuOpen, setMenuOpen] = useState(false);
  const suppressClick = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const configError = facts.representative?.model_config_error;
  const kind = facts.orphan ? "session" : "project";
  // An unassigned session's tile names a session, whose title can be long:
  // it opens through a full-tile button and discloses the full name, so no
  // control ever nests inside another.
  const disclosure = useSessionNameDisclosure(facts.title);
  const orphan = facts.orphan;

  const activate = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onOpen();
  };
  const then = (run?: () => void) => () => {
    setMenuOpen(false);
    run?.();
  };

  const meta = [
    facts.sessionCount != null
      ? `${facts.sessionCount} ${facts.sessionCount === 1 ? "session" : "sessions"}`
      : sessionEnvLabel(facts.representative),
    facts.costMicros > 0 ? formatCostMicros(facts.costMicros) : null,
    compactAge(facts.updatedAt, now) || null,
  ].filter(Boolean);

  return (
    <div
      ref={cardRef}
      data-item-id={facts.id}
      data-item-kind={facts.orphan ? "orphan" : "project"}
      data-item-pinned={facts.pinned ? "true" : "false"}
      role={orphan ? undefined : "button"}
      tabIndex={orphan ? undefined : 0}
      aria-label={orphan ? undefined : facts.title}
      aria-pressed={orphan ? undefined : selected}
      className={cn(
        "group/tile relative flex min-w-0 cursor-default flex-col gap-3 rounded-card border p-4 pl-5 outline-none",
        "bg-elevation-level-1 transition-[border-color,background-color] duration-150 ease-out motion-reduce:transition-none",
        "border-tertiary hover:border-secondary focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
        dragging && "shadow-lg",
        selected && "border-secondary",
      )}
      onClick={(event) => {
        // SAFETY: a mouse event's target is always an element here.
        if ((event.target as HTMLElement).closest("button, a, input, textarea")) return;
        activate();
      }}
      onKeyDown={(event) => {
        if (orphan || event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
    >
      {orphan
        ? disclosure.hint(
            <button
              type="button"
              aria-label={facts.title}
              aria-pressed={selected}
              className="absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]"
              onClick={activate}
            />,
          )
        : null}
      {attention ? (
        <Tooltip
          title="Run finished"
          position={TooltipPosition.BottomLeft}
          sticky
          className="absolute top-2 right-2 z-[1]"
        >
          {/* `bg-brand-450` is the finished-run marker other surfaces look for. */}
          <span className="block size-2 rounded-full bg-brand-450 !bg-[var(--f-green)]" />
        </Tooltip>
      ) : null}
      {reorder ? (
        <DragHandle
          getCardElement={() => cardRef.current}
          onReorderStart={(start) => {
            suppressClick.current = true;
            reorder.onReorderStart(start);
            window.setTimeout(() => {
              suppressClick.current = false;
            }, 100);
          }}
        />
      ) : null}

      <div className={cn("flex min-w-0 items-center gap-3", orphan && "pointer-events-none")}>
        {facts.orphan ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-[var(--f-wash-1)]">
            <Icon iconName={IconName.Chat} size={14} className="text-basic-tertiary" />
          </span>
        ) : (
          <SessionAvatar id={facts.id} size={28} isRunning={facts.running > 0} />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "type-strong min-w-0 truncate text-basic-primary",
                facts.running > 0 && "focus-shimmer",
              )}
            >
              {facts.title}
            </span>
            {facts.pinned ? (
              <Icon iconName={IconName.Pin} size={12} className="shrink-0 text-basic-muted" />
            ) : null}
            {configError ? (
              <Tooltip title={configError} position={TooltipPosition.BottomRight} sticky>
                <Icon
                  iconName={IconName.Repair}
                  size={14}
                  className="shrink-0 text-error-primary"
                />
              </Tooltip>
            ) : null}
          </div>
          <span className="type-meta truncate font-mono text-basic-muted" title={facts.cwd}>
            {facts.cwd}
          </span>
        </div>
      </div>

      <div className="flex min-h-6 min-w-0 items-center justify-between gap-2">
        <p
          className={cn(
            "type-meta tabular flex min-w-0 items-center gap-1.5 text-basic-tertiary",
            orphan && "pointer-events-none",
          )}
        >
          {facts.running > 0 && !facts.orphan ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-basic-primary">
              <span
                aria-hidden
                className="status-dot-pulse size-1.5 rounded-pill bg-[var(--f-ink)]"
              />
              {facts.running}
              <span className="sr-only"> running</span>
            </span>
          ) : null}
          <span className="truncate">{meta.join(" · ")}</span>
        </p>
        <div className="relative z-[1] flex shrink-0 items-center gap-0.5">
          {orphan ? disclosure.action : null}
          <Popover
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            sticky
            placement={PopoverPlacement.BottomLeft}
            size={PopoverSize.Small}
            content={
              <Menu label={`${facts.title} options`}>
                {onNewSession ? (
                  <MenuItem icon={IconName.Add} label="New session" onSelect={then(onNewSession)} />
                ) : null}
                {onIntervalTasks ? (
                  <MenuItem
                    icon={IconName.Clock}
                    label="Interval tasks"
                    onSelect={then(onIntervalTasks)}
                  />
                ) : null}
                {onAssign ? (
                  <MenuItem
                    icon={IconName.Folder}
                    label="Assign to project"
                    onSelect={then(onAssign)}
                  />
                ) : null}
                {onTogglePin ? (
                  <MenuItem
                    icon={facts.pinned ? IconName.Unpin : IconName.Pin}
                    label={facts.pinned ? "Unpin project" : "Pin project"}
                    onSelect={then(onTogglePin)}
                  />
                ) : null}
                {onRename ? (
                  <MenuItem
                    icon={IconName.Edit}
                    label={`Rename ${kind}`}
                    onSelect={then(onRename)}
                  />
                ) : null}
                {reorder ? (
                  <>
                    <MenuItem
                      icon={IconName.ArrowTop}
                      label="Move earlier"
                      disabled={!reorder.canMoveUp}
                      onSelect={then(reorder.onMoveUp)}
                    />
                    <MenuItem
                      icon={IconName.ArrowDown}
                      label="Move later"
                      disabled={!reorder.canMoveDown}
                      onSelect={then(reorder.onMoveDown)}
                    />
                  </>
                ) : null}
                <MenuSeparator />
                <MenuItem
                  icon={IconName.Trash}
                  label={`Delete ${kind}`}
                  destructive
                  onSelect={then(onDelete)}
                />
              </Menu>
            }
          >
            <Button
              variant={ButtonVariant.Ghost}
              size={ButtonSize.Small}
              content={ButtonContent.Icon}
              aria-label={`${facts.title} options`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={cn(
                "max-md:!size-11",
                !menuOpen &&
                  "opacity-0 group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 [@media(hover:none)]:opacity-100",
              )}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon iconName={IconName.MenuHorizontal} />
            </Button>
          </Popover>
        </div>
      </div>
      {facts.speedTierChargesExcluded ? (
        <p className="type-meta text-basic-muted">
          Base-rate estimate; speed-tier charges excluded.
        </p>
      ) : null}
      {facts.subscriptionEstimate ? (
        <p className="type-meta text-basic-muted">
          API-equivalent estimate, not subscription allowance or credits.
        </p>
      ) : null}
      {orphan ? disclosure.overlay : null}
    </div>
  );
}
