import type React from "react";

import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";
import Tooltip, { TooltipPosition } from "../tooltip";

/** Figma ChildSessionActionButtons: Running, Paused, Stopped/ready. */
export type ChildSessionActionState = "running" | "paused" | "ready";

export interface ChildSessionActionButtonsProps {
  state?: ChildSessionActionState;
  busy?: boolean;
  canOpen?: boolean;
  onPause?: () => void;
  onPlay?: () => void;
  onStop?: () => void;
  onOpen?: () => void;
  className?: string;
}

function ActionTooltip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Tooltip title={title} position={TooltipPosition.TopCenter} className="flex h-6 shrink-0">
      <span className="flex size-6 shrink-0 items-center justify-center">{children}</span>
    </Tooltip>
  );
}

function ActionIconButton({
  title,
  label,
  icon,
  variant = ButtonVariant.Ghost,
  disabled,
  onClick,
}: {
  title: string;
  label: string;
  icon: IconName;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <ActionTooltip title={title}>
      <Button
        className="size-6 shrink-0"
        size={ButtonSize.Small}
        variant={variant}
        content={ButtonContent.Icon}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon iconName={icon} size={16} />
      </Button>
    </ActionTooltip>
  );
}

/**
 * Hover/focus chip on a spawned-session card. Visible actions follow the
 * Figma state: stop+pause+open while running, stop+play+open while paused,
 * open only when the child is stopped or ready.
 */
const ChildSessionActionButtons: React.FC<ChildSessionActionButtonsProps> = ({
  state = "ready",
  busy = false,
  canOpen = true,
  onPause,
  onPlay,
  onStop,
  onOpen,
  className = "",
}) => {
  const live = state === "running" || state === "paused";
  return (
    <div
      className={cn(
        "flex h-6 max-h-6 min-h-6 w-fit flex-none items-center overflow-clip rounded-[4px] bg-elevation-level-3 shadow-md",
        live && "gap-1",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {live ? (
        <ActionIconButton
          title="Stop"
          label="Stop session"
          icon={IconName.Stop}
          variant={ButtonVariant.GhostDestructive}
          disabled={busy}
          onClick={onStop}
        />
      ) : null}
      {state === "running" ? (
        <ActionIconButton
          title="Pause"
          label="Pause session"
          icon={IconName.Pause}
          disabled={busy}
          onClick={onPause}
        />
      ) : null}
      {state === "paused" ? (
        <ActionIconButton
          title="Continue"
          label="Continue session"
          icon={IconName.Play}
          disabled={busy || !canOpen}
          onClick={onPlay}
        />
      ) : null}
      <ActionIconButton
        title="Go to session"
        label="Go to session"
        icon={IconName.External}
        disabled={busy || !canOpen}
        onClick={onOpen}
      />
    </div>
  );
};

export default ChildSessionActionButtons;
