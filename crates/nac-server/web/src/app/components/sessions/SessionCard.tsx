import { useState } from "react";

import {
  Icon,
  IconName,
  Loader,
  LoaderSize,
  LoaderVariant,
  SessionAvatar,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import {
  displaySessionTitle,
  formatClock,
  isActiveRun,
  sessionEnvLabel,
} from "@/app/lib/format";
import { providerLabel } from "@/app/lib/providers";
import { useNow } from "@/app/hooks/useNow";
import { SessionCardActions } from "@/app/components/sessions/SessionCardActions";
import type { ManagedSessionSummary, SessionSummarySnapshot } from "@/app/types/api";

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

function RunCount({ runs }: { runs: number }) {
  return (
    <span className="text-micro text-info-primary whitespace-nowrap">
      {runs} {runs === 1 ? "Run" : "Runs"}
    </span>
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
        <span className="text-micro text-basic-muted truncate">{provider}</span>
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
    ? formatClock(activeRun?.started_at_epoch_ms ? now - activeRun.started_at_epoch_ms : 0)
    : null;

  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  // The bottom row swaps metrics for the id and actions as soon as the card is
  // the user's focus, which is also how the design shows the Focused state.
  const showActions = hover || focused || selected;

  const activate = () => onOpen(id);

  return (
    <div
      className={cn(
        "group fade-up relative flex flex-col gap-4 px-6 pt-5 pb-3 rounded-[8px] overflow-hidden cursor-default",
        "bg-elevation-level-1 shadow-convex",
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

      <div className="relative flex items-center gap-4 w-full">
        <SessionAvatar id={id} size={40} />
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 w-full">
            {summary.pinned ? (
              <Icon
                iconName={IconName.Pin}
                className="text-basic-secondary shrink-0"
              />
            ) : null}
            {attention ? (
              <Tooltip
                title="Run finished"
                position={TooltipPosition.BottomLeft}
                sticky
              >
                <span className="block w-2 h-2 rounded-full bg-accent-primary shrink-0" />
              </Tooltip>
            ) : null}
            <div className="header-md text-basic-primary flex-1 min-w-0 truncate">
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
                <Loader size={LoaderSize.Micro} variant={LoaderVariant.Neutral} />
              </div>
            ) : null}
          </div>
          <div className="code code-micro text-basic-tertiary truncate w-full">
            {summary.cwd}
          </div>
        </div>
      </div>

      <div className="relative flex items-center justify-between w-full h-6 gap-2">
        <RunCount runs={summary.run_count} />
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
