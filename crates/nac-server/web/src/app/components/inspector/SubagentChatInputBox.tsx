import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { ButtonVariant, HoverHint, Icon, IconName, Switch, SwitchSize } from "@/app/atoms";
import {
  ComposerFrame,
  ComposerIconButton,
  ComposerPill,
  ComposerSendButton,
} from "@/app/components/inspector/composer/ComposerFrame";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";

const PLACEHOLDER = "Send a message";

const BACKGROUND_HINT =
  "The subagent keeps working after you leave this chat. Steer or stop it from here.";

/** One line of the field on a phone, which is also its collapsed height. */
const MOBILE_ROW_PX = 40;

/** How far the field grows before it starts scrolling instead. */
const MAX_HEIGHT_PX = 180;

export interface SubagentChatInputBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  running: boolean;
  /** Foreground runs keep the switch off and say "Regular run" while they work. */
  background: boolean;
  onBackgroundChange: (background: boolean) => void;
  busy?: boolean;
  /** A start is still pending: nothing more is sent until the target is running. */
  starting?: boolean;
  permission?: ReactNode;
  /**
   * Over a child transcript it floats on the faded ground, as the main
   * composer does. A panel already insets and backs it.
   */
  floating?: boolean;
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
  busy = false,
  starting = false,
  permission,
  floating = false,
}: SubagentChatInputBoxProps) {
  const isMobile = useIsMobile();
  const field = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const filled = value.trim().length > 0;
  const sendable = filled && (running || !starting);
  // A phone keeps a message it is not editing to one truncated line.
  const collapsed = isMobile && !focused && filled;
  const runLabel = running
    ? background
      ? "Running in the background"
      : "Regular run"
    : "Run in the background";
  // A run's Stop rides at the end of the pill, as the goal flag does in the
  // main composer.
  const textInset = isMobile
    ? running
      ? "py-2 pr-2 pl-3"
      : "px-3 py-2"
    : running
      ? "py-3 pr-2 pl-4"
      : "px-4 py-3";

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    if (collapsed) {
      element.style.height = `${MOBILE_ROW_PX}px`;
      return;
    }
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [collapsed, value]);

  return (
    <ComposerFrame
      compact={isMobile}
      faded={floating}
      className={floating ? undefined : "p-0"}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (sendable) onSubmit();
      }}
    >
      <div className="flex items-end gap-2">
        <ComposerPill compact={isMobile} outline={focused ? "focus" : undefined}>
          <div className="relative min-w-0 flex-1">
            <textarea
              ref={field}
              rows={1}
              value={value}
              placeholder={PLACEHOLDER}
              aria-label={PLACEHOLDER}
              disabled={busy}
              className={cn(
                "block w-full resize-none bg-transparent text-medium text-input outline-none placeholder:text-input-placeholder focus:placeholder:text-transparent",
                textInset,
                // The line below stands in for it, because a textarea cannot
                // ellipsize its own overflow.
                collapsed && "overflow-hidden opacity-0",
              )}
              onChange={(event) => onChange(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key !== "Enter" || event.shiftKey) return;
                if (isMobile && !event.metaKey && !event.ctrlKey) return;
                event.preventDefault();
                if (sendable && !busy) onSubmit();
              }}
            />
            {collapsed ? (
              <div
                aria-hidden
                className={cn("pointer-events-none absolute inset-0 flex items-center", textInset)}
              >
                <span className="w-full truncate text-medium text-input">{value}</span>
              </div>
            ) : null}
          </div>
          {running ? (
            <ComposerIconButton
              compact={isMobile}
              type="button"
              variant={ButtonVariant.Ghost}
              disabled={busy}
              onClick={onStop}
              aria-label="Stop"
            >
              <Icon iconName={IconName.Stop} size={24} />
            </ComposerIconButton>
          ) : null}
        </ComposerPill>
        <ComposerSendButton
          compact={isMobile}
          type="submit"
          disabled={busy || !sendable}
          aria-label={running ? "Steer" : "Send"}
        >
          <Icon iconName={IconName.ArrowTop} />
        </ComposerSendButton>
      </div>
      <div className="flex min-h-6 items-center gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {running ? null : (
            <Switch
              size={isMobile ? SwitchSize.Large : SwitchSize.Medium}
              checked={background}
              disabled={busy || starting}
              aria-label="Run in the background"
              onChange={onBackgroundChange}
            />
          )}
          <span
            className={cn(
              "truncate",
              isMobile ? "label-small" : "label-micro",
              running && background
                ? "text-info-primary"
                : running
                  ? "text-basic-tertiary"
                  : "text-basic-primary",
            )}
          >
            {runLabel}
          </span>
          <HoverHint title={runLabel} description={BACKGROUND_HINT} muted />
        </div>
        {permission}
      </div>
    </ComposerFrame>
  );
}
