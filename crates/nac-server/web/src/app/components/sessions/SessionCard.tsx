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
import { cn } from "@/app/lib/cn";
import {
  displaySessionTitle,
  formatClock,
  formatCostMicros,
  isActiveRun,
  sessionEnvLabel,
} from "@/app/lib/format";
import { providerLabel } from "@/app/lib/providers";
import { useIsDesktop, useIsMobile } from "@/app/hooks/useMediaQuery";
import { useNow } from "@/app/hooks/useNow";
import { SessionCardActions } from "@/app/components/sessions/SessionCardActions";
import type {
  ManagedSessionSummary,
  SessionSummarySnapshot,
} from "@/app/types/api";

// Figma ChatSessionCard has a full-bleed "Surface" layer below the content that
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

function Metrics({ summary }: { summary: SessionSummarySnapshot }) {
  const costLabel =
    summary.total_cost_micros != null && summary.total_cost_micros > 0
      ? formatCostMicros(summary.total_cost_micros)
      : null;
  return (
    <div className="flex items-center gap-2.5 shrink-0 min-w-0">
      {costLabel ? (
        <span className="text-micro text-basic-primary whitespace-nowrap">
          {costLabel}
        </span>
      ) : null}
      <span className="text-micro text-info-primary whitespace-nowrap truncate">
        {summary.run_count} {summary.run_count === 1 ? "Run" : "Runs"}
      </span>
    </div>
  );
}

function Provenance({ summary }: { summary: SessionSummarySnapshot }) {
  const provider = providerLabel(summary.backend);
  return (
    <div className="flex flex-wrap items-center gap-2.5 min-w-0 whitespace-nowrap">
      <span className="label-micro text-basic-tertiary">
        {sessionEnvLabel(summary)}
      </span>
      {provider ? (
        <span className="text-micro text-basic-muted truncate md:max-w-[128px]">
          {provider}
        </span>
      ) : null}
    </div>
  );
}

export interface SessionReorderStart {
  sessionId: string;
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
  onReorderStart: (start: SessionReorderStart) => void;
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
          sessionId: card.dataset.sessionId ?? "",
          pinned: card.dataset.sessionPinned === "true",
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

export interface SessionCardReorder {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReorderStart: (start: SessionReorderStart) => void;
}

interface SessionCardProps {
  entry: ManagedSessionSummary;
  selected: boolean;
  attention: boolean;
  onOpen: (id: string) => void;
  onTogglePin: (entry: ManagedSessionSummary) => void;
  onRename: (entry: ManagedSessionSummary) => void;
  onDelete: (entry: ManagedSessionSummary) => void;
  onStop: (entry: ManagedSessionSummary) => void;
  /** When set (Default sort), shows desktop handle / mobile arrows. */
  reorder?: SessionCardReorder;
  /** Card is the active drag ghost (follows the pointer). */
  dragging?: boolean;
}

export function SessionCard({
  entry,
  selected,
  attention,
  onOpen,
  onTogglePin,
  onRename,
  onDelete,
  onStop,
  reorder,
  dragging = false,
}: SessionCardProps) {
  const summary = entry.summary;
  const id = summary.session_id;
  const activeRun = entry.active_run;
  const running = isActiveRun(activeRun);

  const now = useNow(1000, running);
  const clock = running
    ? formatClock(
        activeRun?.started_at_epoch_ms
          ? now - activeRun.started_at_epoch_ms
          : 0,
      )
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
    onOpen(id);
  };

  return (
    <div
      ref={cardRef}
      data-session-id={id}
      data-session-pinned={summary.pinned ? "true" : "false"}
      className={cn(
        "group fade relative flex flex-col rounded-[8px] overflow-hidden cursor-default",
        isMobile ? "gap-4 px-4 pt-4 pb-2" : "gap-4 px-6 pt-5 pb-3",
        "shadow-convex",
        running ? "bg-elevation-level-3" : "bg-elevation-level-1",
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
        <SessionAvatar id={id} size={40} isRunning={running} />
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 w-full">
            {summary.pinned ? (
              <Icon
                iconName={IconName.Pin}
                className="text-basic-secondary shrink-0"
              />
            ) : null}
            <div
              className={cn(
                "header-md flex-1 min-w-0 truncate",
                running ? "text-shimmer-basic" : "text-basic-primary",
              )}
            >
              {displaySessionTitle(summary)}
            </div>
            {summary.model_config_error ? (
              <Tooltip
                title={summary.model_config_error}
                position={TooltipPosition.BottomRight}
                sticky
              >
                <Icon
                  iconName={IconName.Repair}
                  className="text-error-primary shrink-0"
                />
              </Tooltip>
            ) : null}
            {running ? (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-basic-primary text-sm leading-5">
                  {clock}
                </span>
                <Loader size={LoaderSize.Small} />
              </div>
            ) : null}
          </div>
          <div className="code code-micro text-basic-tertiary truncate w-full">
            {summary.cwd}
          </div>
        </div>
      </div>
      {!isDesktop ? <Provenance summary={summary} /> : null}

      <div className="relative flex items-center justify-between w-full h-6 gap-2">
        <Metrics summary={summary} />
        {showActions ? (
          <SessionCardActions
            pinned={Boolean(summary.pinned)}
            running={running}
            onTogglePin={() => onTogglePin(entry)}
            onRename={() => onRename(entry)}
            onDelete={() => onDelete(entry)}
            onStop={() => onStop(entry)}
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
          <Provenance summary={summary} />
        )}
      </div>
    </div>
  );
}
