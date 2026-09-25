import { useLayoutEffect, useRef, type ReactNode } from "react";

import {
  Badge,
  BadgeColor,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Switch,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import type { TraditionalChildStatus } from "@/app/types/api";

const BACKGROUND_HINT =
  "The subagent keeps working after you leave this chat. Steer or stop it from here.";

const STATUS_BADGE: Partial<Record<TraditionalChildStatus, { text: string; color: BadgeColor }>> = {
  completed: { text: "Completed", color: BadgeColor.Green },
  cancelled: { text: "Cancelled", color: BadgeColor.Yellow },
  failed: { text: "Failed", color: BadgeColor.Red },
  interrupted: { text: "Interrupted", color: BadgeColor.Yellow },
};

export interface SubagentChatInputBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  running: boolean;
  /** Foreground runs keep the switch off and say "Regular run" while they work. */
  background: boolean;
  onBackgroundChange: (background: boolean) => void;
  status?: TraditionalChildStatus | null;
  busy?: boolean;
  permission?: ReactNode;
  /** Put the caret in the field once this composer is shown. */
  autoFocus?: boolean;
  /** Changes whenever a new launch should take the caret again. */
  focusRequest?: number;
}

/**
 * The short composer under a child transcript and inside the Subagents preview.
 * It sends, steers, or stops. It does not carry the parent composer's model,
 * effort, or goal controls.
 */
export function SubagentChatInputBox({
  value,
  onChange,
  onSubmit,
  onStop,
  running,
  background,
  onBackgroundChange,
  status = null,
  busy = false,
  permission,
  autoFocus = false,
  focusRequest = 0,
}: SubagentChatInputBoxProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const filled = value.trim().length > 0;
  const placeholder = running ? "Steer a message" : "Send a message";
  const badge = !running && status ? STATUS_BADGE[status] : undefined;
  const runLabel = running
    ? background
      ? "Running in the background"
      : "Regular run"
    : "Run in the background";

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  useLayoutEffect(() => {
    if (!autoFocus) return;
    const focus = () => field.current?.focus({ preventScroll: true });
    focus();
    // The spawn menu unmounts in the same turn and can move focus back to the
    // parent composer. Retry once the panel is focusable.
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, focusRequest]);

  return (
    <form
      className="flex w-full flex-col gap-4 rounded-[8px] bg-elevation-level-2 p-4 shadow-2xl"
      onSubmit={(event) => {
        event.preventDefault();
        if (running && !filled) onStop();
        else if (filled) onSubmit();
      }}
    >
      <div className="relative flex items-end overflow-hidden rounded-[4px] bg-input py-2 pr-12 pl-2">
        <textarea
          ref={field}
          rows={1}
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={busy}
          className="max-h-40 min-h-5 w-full resize-none bg-transparent px-1 text-small text-input outline-none placeholder:text-input-placeholder"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            if (filled && !busy) onSubmit();
          }}
        />
        <Button
          type="submit"
          size={ButtonSize.Medium}
          variant={ButtonVariant.Primary}
          content={ButtonContent.Icon}
          className="absolute right-0 bottom-0"
          disabled={busy || (!running && !filled)}
          aria-label={running ? (filled ? "Steer" : "Stop") : "Send"}
        >
          <Icon iconName={running && !filled ? IconName.Stop : IconName.ArrowTop} />
        </Button>
      </div>
      <div className="flex items-center gap-2.5 h-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {running ? null : (
            <Switch
              checked={background}
              disabled={busy}
              aria-label="Run in the background"
              onChange={onBackgroundChange}
            />
          )}
          <span
            className={cn(
              "label-micro truncate",
              running && background
                ? "text-info-primary"
                : running
                  ? "text-basic-tertiary"
                  : "text-basic-primary",
            )}
          >
            {runLabel}
          </span>
          <Tooltip
            title={runLabel}
            description={BACKGROUND_HINT}
            position={TooltipPosition.TopCenter}
          >
            <span className="inline-flex text-basic-tertiary">
              <Icon iconName={IconName.Info} size={16} />
            </span>
          </Tooltip>
          {badge ? <Badge text={badge.text} color={badge.color} className="px-1 py-[2px]" /> : null}
        </div>
        {permission}
      </div>
    </form>
  );
}
