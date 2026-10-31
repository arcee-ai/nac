import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { ButtonVariant, HoverHint, Icon, IconName, Switch, SwitchSize } from "@/app/atoms";
import {
  ComposerCard,
  ComposerFrame,
  ComposerIconButton,
  ComposerInlineButton,
  ComposerInlineSlot,
} from "@/app/components/inspector/composer/ComposerFrame";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";

const PLACEHOLDER = "Send a message";

const BACKGROUND_HINT =
  "The subagent keeps working after you leave this chat. Steer or stop it from here.";

/** One line of the field, which is also its collapsed height. */
const ROW_PX = { mobile: 40, wide: 48 };

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
  const rowPx = isMobile ? ROW_PX.mobile : ROW_PX.wide;
  // A message the field is not editing rests on one truncated line.
  const collapsed = !focused && value !== "";
  const runLabel = running
    ? background
      ? "Running in the background"
      : "Regular run"
    : "Run in the background";
  // The text and the collapsed line drawn over it share one inset.
  const textInset = isMobile ? "py-2 pr-2 pl-3" : "py-3 pr-2 pl-4";

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = `${rowPx}px`;
    if (collapsed) return;
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [collapsed, rowPx, value]);

  // Tapping the collapsed line carries on writing, so the caret goes last.
  const focusEnd = useCallback(() => {
    const element = field.current;
    if (!element) return;
    element.focus();
    // iOS Safari honours the properties but not setSelectionRange here, and
    // only once the field has actually taken the focus.
    requestAnimationFrame(() => {
      const textarea = field.current;
      if (!textarea) return;
      const end = textarea.value.length;
      textarea.selectionStart = end;
      textarea.selectionEnd = end;
      textarea.scrollTop = textarea.scrollHeight;
    });
  }, []);

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
      <ComposerCard
        compact={isMobile}
        surface={focused ? "focus" : undefined}
        outline="tertiary"
        className={isMobile ? "gap-6" : undefined}
      >
        <div className="flex items-end">
          <div className="relative min-w-0 flex-1">
            <textarea
              ref={field}
              rows={1}
              value={value}
              placeholder={PLACEHOLDER}
              aria-label={PLACEHOLDER}
              disabled={busy}
              className={cn(
                "block w-full resize-none border-none bg-transparent text-medium text-input outline-none placeholder:text-input-placeholder focus:placeholder:text-transparent",
                textInset,
                // The line below stands in for it, because a textarea cannot
                // ellipsize its own overflow.
                collapsed && "pointer-events-none overflow-hidden opacity-0",
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
                aria-hidden="true"
                className={cn("absolute inset-0 flex cursor-text items-center", textInset)}
                onClick={focusEnd}
              >
                <span className="w-full truncate text-medium text-input">{value}</span>
              </div>
            ) : null}
          </div>
          {/* Stop keeps a place of its own beside Send, so pressing Steer
              again can never land on it. */}
          {running ? (
            <ComposerInlineSlot compact={isMobile}>
              <ComposerInlineButton
                type="button"
                variant={ButtonVariant.Ghost}
                disabled={busy}
                onClick={onStop}
                aria-label="Stop"
              >
                <Icon iconName={IconName.Stop} size={20} />
              </ComposerInlineButton>
            </ComposerInlineSlot>
          ) : null}
          <ComposerIconButton
            compact={isMobile}
            type="submit"
            variant={ButtonVariant.Primary}
            disabled={busy || !sendable}
            aria-label={running ? "Steer" : "Send"}
          >
            <Icon iconName={IconName.ArrowTop} />
          </ComposerIconButton>
        </div>
        <div className={cn("flex min-h-6 items-center px-2", isMobile ? "gap-3" : "gap-2.5")}>
          <div className={cn("flex min-w-0 flex-1 items-center gap-2", !isMobile && "pl-2")}>
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
      </ComposerCard>
    </ComposerFrame>
  );
}
