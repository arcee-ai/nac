import { useState } from "react";

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
        <span className="text-micro text-basic-muted truncate max-w-[128px]">
          {provider}
        </span>
      ) : null}
    </div>
  );
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

  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  // The bottom row swaps provenance for actions as soon as the card is the
  // user's focus, which is also how the design shows the Focused state.
  const showActions = hover || focused || selected;

  const activate = () => onOpen(id);

  return (
    <div
      className={cn(
        "group fade-up relative flex flex-col gap-4 px-6 pt-5 pb-3 rounded-[8px] overflow-hidden cursor-default",
        "shadow-convex",
        running ? "bg-elevation-level-3" : "bg-elevation-level-1",
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
      onMouseEnter={() => setHover(true)}
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
          backgroundColor: `var(${surfaceToken({ selected, hover, pressed })})`,
        }}
      />
      {selected || focused ? (
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
          />
        ) : (
          <Provenance summary={summary} />
        )}
      </div>
    </div>
  );
}
