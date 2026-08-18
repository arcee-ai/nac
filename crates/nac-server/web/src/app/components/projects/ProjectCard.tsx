import { useRef, useState } from "react";

import {
  Icon,
  IconName,
  Loader,
  LoaderSize,
  SessionAvatar,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { ProjectCardActions } from "@/app/components/projects/ProjectCardActions";
import { useIsDesktop, useIsMobile } from "@/app/hooks/useMediaQuery";
import { useNow } from "@/app/hooks/useNow";
import { cn } from "@/app/lib/cn";
import {
  displaySessionTitle,
  formatClock,
  formatCostMicros,
  isActiveRun,
  sessionEnvLabel,
} from "@/app/lib/format";
import type { ProjectListItem } from "@/app/lib/projects";
import { providerLabel } from "@/app/lib/providers";
import type { SessionSummarySnapshot } from "@/app/types/api";

// Figma ProjectCard has a full-bleed "Surface" layer below the content that
// carries the interaction state. Tokens are applied as CSS variables because the
// generated utilities have no group-hover/group-active variants.
const SURFACE_TOKENS = {
  default: "--color-bg-btn-ghost",
  hovered: "--color-bg-btn-ghost-hovered",
  pressed: "--color-bg-btn-ghost-pressed",
  selected: "--color-bg-btn-ghost-highlighted",
  selectedHovered: "--color-bg-btn-ghost-highlighted-hovered",
  selectedPressed: "--color-bg-btn-ghost-highlighted-pressed",
};

function surfaceToken({
  selected,
  hover,
  pressed,
}: {
  selected: boolean;
  hover: boolean;
  pressed: boolean;
}) {
  if (pressed) {
    return selected ? SURFACE_TOKENS.selectedPressed : SURFACE_TOKENS.pressed;
  }
  if (hover) {
    return selected ? SURFACE_TOKENS.selectedHovered : SURFACE_TOKENS.hovered;
  }
  return selected ? SURFACE_TOKENS.selected : SURFACE_TOKENS.default;
}

/**
 * What a card shows, flattened from either kind of row so the body below reads
 * the same for both. A project draws its provenance from its newest chat, which
 * is the only place the environment is recorded.
 */
interface CardFacts {
  id: string;
  orphan: boolean;
  title: string;
  cwd: string;
  pinned: boolean;
  running: boolean;
  costMicros: number;
  /** "3 Chats" for a project, "2 Runs" for a loose chat. */
  countLabel: string;
  /** The chat whose run drives the clock, and whose environment is shown. */
  representative: SessionSummarySnapshot | null;
  activeRunStartedAt: number | null;
}

function factsFor(item: ProjectListItem): CardFacts {
  if (item.kind === "project") {
    const { project, sessions, running, totalCostMicros } = item.entry;
    const live = sessions.find((entry) => isActiveRun(entry.active_run));
    return {
      id: project.project_id,
      orphan: false,
      title: project.name,
      cwd: project.cwd,
      pinned: project.pinned,
      running: running > 0,
      costMicros: totalCostMicros,
      countLabel: `${sessions.length} ${sessions.length === 1 ? "Chat" : "Chats"}`,
      representative: live?.summary ?? sessions[0]?.summary ?? null,
      activeRunStartedAt: live?.active_run?.started_at_epoch_ms ?? null,
    };
  }
  const { summary, active_run } = item.session;
  return {
    id: summary.session_id,
    orphan: true,
    title: displaySessionTitle(summary),
    cwd: summary.cwd,
    pinned: Boolean(summary.pinned),
    running: isActiveRun(active_run),
    costMicros: summary.total_cost_micros ?? 0,
    countLabel: `${summary.run_count} ${summary.run_count === 1 ? "Run" : "Runs"}`,
    representative: summary,
    activeRunStartedAt: active_run?.started_at_epoch_ms ?? null,
  };
}

function Metrics({ facts }: { facts: CardFacts }) {
  const costLabel = facts.costMicros > 0 ? formatCostMicros(facts.costMicros) : null;
  return (
    <div className="flex items-center gap-2.5 shrink-0 min-w-0">
      {costLabel ? (
        <span className="text-micro text-basic-primary whitespace-nowrap">{costLabel}</span>
      ) : null}
      <span className="text-micro text-info-primary whitespace-nowrap truncate">
        {facts.countLabel}
      </span>
    </div>
  );
}

function Provenance({ facts }: { facts: CardFacts }) {
  const provider = providerLabel(facts.representative?.backend);
  return (
    <div className="flex flex-wrap items-center gap-2.5 min-w-0 whitespace-nowrap">
      <span className="label-micro text-basic-tertiary">
        {sessionEnvLabel(facts.representative)}
      </span>
      {provider ? (
        <span className="text-micro text-basic-muted truncate md:max-w-[128px]">{provider}</span>
      ) : null}
    </div>
  );
}

export interface ProjectReorderStart {
  itemId: string;
  pinned: boolean;
  clientX: number;
  clientY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/** Two vertical bars — Figma Handler on desktop Default-sort cards. */
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
      className={cn(
        "absolute right-1.5 top-1/2 z-1 -translate-y-1/2",
        "flex h-6 items-center gap-[3px]",
        "cursor-grab active:cursor-grabbing touch-none",
        "rounded-sm border-0 bg-transparent p-0",
      )}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const card = getCardElement();
        if (!card) return;
        const rect = card.getBoundingClientRect();
        // Capture on the handle so moves keep flowing after the card floats.
        e.currentTarget.setPointerCapture(e.pointerId);
        onReorderStart({
          itemId: card.dataset.itemId ?? "",
          pinned: card.dataset.itemPinned === "true",
          clientX: e.clientX,
          clientY: e.clientY,
          offsetX: e.clientX - rect.left,
          offsetY: e.clientY - rect.top,
          width: rect.width,
          height: rect.height,
        });
      }}
    >
      <span className="h-full w-px rounded-[2px] bg-divider-primary" />
      <span className="h-full w-px rounded-[2px] bg-divider-primary" />
    </button>
  );
}

export interface ProjectCardReorder {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReorderStart: (start: ProjectReorderStart) => void;
}

interface ProjectCardProps {
  item: ProjectListItem;
  selected: boolean;
  attention: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  onRename: () => void;
  onDelete: () => void;
  /** Orphan rows only: file the chat under a project. */
  onAssign?: () => void;
  /** Orphan rows only: stop the run instead of deleting mid-flight. */
  onStop?: () => void;
  /** When set (Default sort), shows desktop handle / mobile arrows. */
  reorder?: ProjectCardReorder;
  /** Card is the active drag ghost (follows the pointer). */
  dragging?: boolean;
}

/**
 * One row of the project list: either a project with the chats inside it rolled
 * up, or a chat that belongs to none. Both open with a click and carry the same
 * pin, rename and delete controls, so the listing reads as one surface.
 */
export function ProjectCard({
  item,
  selected,
  attention,
  onOpen,
  onTogglePin,
  onRename,
  onDelete,
  onAssign,
  onStop,
  reorder,
  dragging = false,
}: ProjectCardProps) {
  const facts = factsFor(item);
  const configError = facts.representative?.model_config_error;

  const now = useNow(1000, facts.running);
  const clock = facts.running
    ? formatClock(facts.activeRunStartedAt ? now - facts.activeRunStartedAt : 0)
    : null;

  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const suppressClick = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // The bottom row swaps provenance for actions as soon as the card is the
  // user's focus, which is also how the design shows the Focused state. A touch
  // screen never reaches that state, so the actions stay out and the
  // provenance moves up under the title instead.
  const showActions = !isDesktop || hover || focused || selected;
  const showDesktopHandle = Boolean(reorder) && isDesktop;
  const showMobileReorder = Boolean(reorder) && !isDesktop;
  // Touch / narrow layouts stick "hover" after a tap; only desktop gets hover bg.
  const surfaceHover = isDesktop && hover;

  const activate = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onOpen();
  };

  return (
    <div
      ref={cardRef}
      data-item-id={facts.id}
      data-item-pinned={facts.pinned ? "true" : "false"}
      className={cn(
        "group fade relative flex flex-col rounded-[8px] overflow-hidden cursor-default",
        isMobile ? "gap-4 px-4 pt-4 pb-2" : "gap-4 px-6 pt-5 pb-3",
        "shadow-convex",
        facts.running ? "bg-elevation-level-3" : "bg-elevation-level-1",
        dragging && "shadow-lg",
      )}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
      onMouseEnter={() => {
        if (isDesktop) setHover(true);
      }}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPointerDown={(e) => {
        // Inner controls own their pressed state, so the card surface stays calm.
        if (
          e.button === 0 &&
          // SAFETY: a pointer event's target is always an element in practice;
          // the cast only widens the EventTarget the DOM event types declare.
          !(e.target as HTMLElement).closest("button, a, input, textarea")
        ) {
          setPressed(true);
        }
      }}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
    >
      <div
        className="absolute inset-0 rounded-[8px] pointer-events-none ease-out"
        style={{
          backgroundColor: `var(${surfaceToken({ selected, hover: surfaceHover, pressed })})`,
        }}
      />
      {selected || focused || dragging ? (
        <div
          className="absolute inset-0 rounded-[8px] pointer-events-none border-2"
          style={{ borderColor: "var(--blue-500)" }}
        />
      ) : null}
      {attention ? (
        <Tooltip
          title="Run finished"
          position={TooltipPosition.BottomLeft}
          sticky
          className="absolute left-2 top-2 z-1"
        >
          <span className="block size-2 rounded-full bg-accent-primary" />
        </Tooltip>
      ) : null}

      {showDesktopHandle && reorder ? (
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

      <div className="relative flex items-center gap-4 w-full">
        <SessionAvatar id={facts.id} size={40} isRunning={facts.running} />
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 w-full">
            {facts.pinned ? (
              <Icon iconName={IconName.Pin} className="text-basic-secondary shrink-0" />
            ) : null}
            {/* An unassigned chat says so on the card, because the listing is
                otherwise all projects and it would read as one. */}
            {facts.orphan ? (
              <Tooltip title="Not in any project" position={TooltipPosition.BottomLeft} sticky>
                <Icon iconName={IconName.Chat} className="text-basic-muted shrink-0" />
              </Tooltip>
            ) : null}
            <div
              className={cn(
                "header-md flex-1 min-w-0 truncate",
                facts.running ? "text-shimmer-basic" : "text-basic-primary",
              )}
            >
              {facts.title}
            </div>
            {configError ? (
              <Tooltip title={configError} position={TooltipPosition.BottomRight} sticky>
                <Icon iconName={IconName.Repair} className="text-error-primary shrink-0" />
              </Tooltip>
            ) : null}
            {facts.running ? (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-basic-primary text-sm leading-5">{clock}</span>
                <Loader size={LoaderSize.Small} />
              </div>
            ) : null}
          </div>
          <div className="code code-micro text-basic-tertiary truncate w-full">{facts.cwd}</div>
        </div>
      </div>
      {!isDesktop ? <Provenance facts={facts} /> : null}

      <div className="relative flex items-center justify-between w-full h-6 gap-2">
        <Metrics facts={facts} />
        {showActions ? (
          <ProjectCardActions
            orphan={facts.orphan}
            pinned={facts.pinned}
            running={facts.running}
            onTogglePin={onTogglePin}
            onRename={onRename}
            onDelete={onDelete}
            onAssign={onAssign}
            onStop={onStop}
            reorder={
              showMobileReorder && reorder
                ? {
                    canMoveUp: reorder.canMoveUp,
                    canMoveDown: reorder.canMoveDown,
                    onMoveUp: reorder.onMoveUp,
                    onMoveDown: reorder.onMoveDown,
                  }
                : undefined
            }
          />
        ) : (
          <Provenance facts={facts} />
        )}
      </div>
    </div>
  );
}
