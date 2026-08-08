import { useCallback, useEffect, useRef, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Loader,
  LoaderSize,
  StickyButton,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { ModelPicker } from "@/app/components/inspector/ModelPicker";
import { SshBadge } from "@/app/components/SshBadge";
import {
  resolveCatalogModel,
  type ResolvedCatalogModel,
} from "@/app/lib/catalog";
import { cn } from "@/app/lib/cn";
import {
  ENV_SSH,
  formatClock,
  formatCostMicros,
  formatTokensCompact,
  runMetrics,
  sessionEnvLabel,
} from "@/app/lib/format";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { useNow } from "@/app/hooks/useNow";
import { perfRender } from "@/app/lib/perfDebug";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import {
  useModelCatalog,
  useSshConnect,
  useSubmitRun,
} from "@/app/services/queries";
import { pushLocalEvent, useRunning } from "@/app/store/runtimeStore";
import {
  markSshConnected,
  markSshDisconnected,
  sshTargetFromSummary,
  useSshConnectionStatus,
} from "@/app/store/sshConnectionStore";
import type {
  ManagedSessionSummary,
  SessionSnapshotResponse,
} from "@/app/types/api";

/** One line of the field, which is also its collapsed height. */
const ROW_PX = { mobile: 40, wide: 48 };

/** How far the field grows before it starts scrolling instead. */
const MAX_HEIGHT_PX = { mobile: 128, wide: 200 };

/**
 * TopBar's HeaderSurface upside down. The phone composer floats over the
 * transcript rather than sitting in a card, so the ground fades in beneath it
 * and takes the scrolling messages with it.
 */
const GROUND_FADE_UP = {
  backgroundImage:
    "linear-gradient(to top, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))",
};

interface ChatInputBoxProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  entry: ManagedSessionSummary | null;
}

function StatBadge({
  iconName,
  prefix,
  value,
  iconSize = 14,
  className,
  title,
  showIcon = true,
}: {
  iconName?: IconName;
  prefix?: string;
  value: string;
  iconSize?: 14 | 16;
  className?: string;
  title: string;
  showIcon?: boolean;
}) {
  return (
    <Tooltip title={title} position={TooltipPosition.TopCenter}>
      <div
        className={cn(
          "flex items-center gap-[2px] py-1 whitespace-nowrap",
          className,
        )}
      >
        {prefix ? (
          <span className="label-micro">{prefix}</span>
        ) : showIcon && iconName ? (
          <Icon iconName={iconName} size={iconSize} />
        ) : null}
        <span className="label-micro">{value}</span>
      </div>
    </Tooltip>
  );
}

/**
 * Context reading against the catalog's window: "6.8K / 200K" for a model the
 * catalog knows, and the same with an "est." marker and no percentage when the
 * window is only the provider's default — the figure itself is a guess then.
 */
function contextGauge(
  used: number | null,
  resolved: ResolvedCatalogModel,
): { value: string; title: string } {
  const tokens = formatTokensCompact(used);
  const window = resolved.contextWindow;
  if (!window || used == null) {
    return { value: tokens, title: "Orchestrator context" };
  }
  const limit = formatTokensCompact(window);
  if (resolved.estimated) {
    return {
      value: `${tokens} / ${limit} est.`,
      title: `Orchestrator context against ${resolved.provider?.id ?? "the provider"}'s default window — the catalog does not know this model, so the limit is an estimate`,
    };
  }
  return {
    value: `${tokens} / ${limit}`,
    title: `Orchestrator context — ${Math.round((used / window) * 100)}% of the model's context window`,
  };
}

/**
 * Message field plus the run status bar that replaced the old metrics grid:
 * model, environment, cumulative token usage and the run timer.
 */
export function ChatInputBox({
  sessionId,
  snapshot,
  entry,
}: ChatInputBoxProps) {
  perfRender("ChatInputBox");
  const [value, setValue] = useState("");
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  // Everything narrower than the desktop column drops what will not fit there:
  // the model name, the per-direction token columns and the timer's glyph.
  const narrow = isMobile || isTablet;
  // A phone keeps the message on one truncated line until the field is focused,
  // then grows the pill over the transcript.
  const [focused, setFocused] = useState(false);
  const collapsed = isMobile && !focused;
  const rowPx = isMobile ? ROW_PX.mobile : ROW_PX.wide;
  const maxHeightPx = isMobile ? MAX_HEIGHT_PX.mobile : MAX_HEIGHT_PX.wide;
  const running = useRunning();
  const toast = useToast();
  const actions = useSessionActions();
  const submitRun = useSubmitRun();
  const ref = useRef<HTMLTextAreaElement>(null);

  const metrics = runMetrics(snapshot, entry);
  const catalog = useModelCatalog();
  const context = contextGauge(
    metrics.usage?.total_tokens ?? null,
    resolveCatalogModel(
      catalog.data,
      snapshot?.metadata?.backend,
      metrics.model,
    ),
  );
  const now = useNow(1000, running);
  const elapsedMs = metrics.startedAt
    ? now - metrics.startedAt
    : metrics.lastResponseMs;

  const sshTarget = sshTargetFromSummary(entry?.summary);
  const sshStatus = useSshConnectionStatus(sshTarget);
  const connectSsh = useSshConnect();
  const isSsh = sessionEnvLabel(entry?.summary) === ENV_SSH;

  const busy = submitRun.isPending || running;
  const canSend = Boolean(value.trim()) && !busy;

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = `${rowPx}px`;
    el.style.height = `${Math.min(el.scrollHeight, maxHeightPx)}px`;
  }, [rowPx, maxHeightPx]);

  // A collapsed field is one line whatever it holds, which is a height it
  // cannot work out for itself; leaving the collapse restores the content's.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (collapsed) {
      el.style.height = `${ROW_PX.mobile}px`;
      el.style.overflow = "hidden";
    } else {
      el.style.overflow = "";
      resize();
    }
  }, [collapsed, resize]);

  /** Tapping the collapsed line means "carry on typing", so the caret goes last. */
  const focusEnd = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // iOS Safari honours the properties but not setSelectionRange here, and
    // only once the field has actually taken the focus.
    requestAnimationFrame(() => {
      if (!ref.current) return;
      const end = ref.current.value.length;
      ref.current.selectionStart = end;
      ref.current.selectionEnd = end;
      ref.current.scrollTop = ref.current.scrollHeight;
    });
  }, []);

  const reconnectSsh = useCallback(async () => {
    if (!sshTarget || connectSsh.isPending) return;
    try {
      await connectSsh.mutateAsync(sshTarget);
      markSshConnected(sshTarget);
    } catch (error) {
      markSshDisconnected(sshTarget);
      toast.error(`SSH reconnect failed: ${errorMessage(error)}`);
    }
  }, [sshTarget, connectSsh, toast]);

  const submit = useCallback(async () => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    try {
      await submitRun.mutateAsync({ id: sessionId, prompt });
      pushLocalEvent("run", `▶ submitted: ${prompt.slice(0, 80)}`);
      setValue("");
      if (ref.current) ref.current.style.height = `${rowPx}px`;
    } catch (error) {
      const message = errorMessage(error);
      pushLocalEvent("error", `submit failed: ${message}`, true);
      toast.error(`Failed to send: ${message}`);
    }
  }, [value, busy, sessionId, submitRun, toast, rowPx]);

  const stop = useCallback(async () => {
    const summary = entry?.summary;
    if (summary) await actions.stopRun(summary);
  }, [actions, entry]);

  const settingsButton = (
    <Tooltip title="Session settings" position={TooltipPosition.TopLeft}>
      <Button
        // A phone gets the design's 40px circle around a 24px glyph; the status
        // bar it sits in elsewhere has room for the 24px square only.
        className={isMobile ? "btn-round" : undefined}
        size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        content={ButtonContent.Icon}
        aria-label="Session settings"
        onClick={() => actions.settings(sessionId)}
      >
        <Icon iconName={IconName.Gear} size={isMobile ? undefined : 16} />
      </Button>
    </Tooltip>
  );

  const sendIcon = <Icon iconName={running ? IconName.Stop : IconName.Plane} />;
  const sendLabel = running ? "Stop run" : "Send";
  const sendType = running ? "button" : "submit";
  const sendDisabled = !running && !canSend;
  const onSend = running ? () => void stop() : undefined;

  const sendButton = isMobile ? (
    <StickyButton
      className="shrink-0"
      variant={ButtonVariant.Primary}
      content={ButtonContent.Icon}
      type={sendType}
      disabled={sendDisabled}
      aria-label={sendLabel}
      onClick={onSend}
    >
      {sendIcon}
    </StickyButton>
  ) : (
    <Button
      className="absolute bottom-0 right-0"
      size={ButtonSize.Large}
      variant={ButtonVariant.Primary}
      content={ButtonContent.Icon}
      type={sendType}
      disabled={sendDisabled}
      aria-label={sendLabel}
      onClick={onSend}
    >
      {sendIcon}
    </Button>
  );

  const field = (
    <div
      className={cn(
        "relative flex items-end",
        isMobile
          ? cn(
              "flex-1 min-w-0 rounded-[20px] bg-elevation-level-3 shadow-2xl overflow-hidden",
              // The reserved lane is the settings glyph's, so an expanded pill
              // — which hides that glyph — takes the width back.
              collapsed && "pr-[40px]",
            )
          : "rounded-[4px] bg-input shadow-concave pr-[48px]",
      )}
    >
      <div className="relative flex-1 min-w-0">
        <textarea
          ref={ref}
          className={cn(
            "block w-full bg-transparent resize-none border-none outline-none text-medium text-input placeholder:text-input-placeholder",
            isMobile ? "px-4 py-2" : "p-3",
            // The line below stands in for it while it is a single row, because
            // a textarea cannot ellipsize its own overflow.
            collapsed && "opacity-0 pointer-events-none",
          )}
          rows={1}
          placeholder="Send a message"
          spellCheck={false}
          value={value}
          style={{ minHeight: `${rowPx}px`, maxHeight: `${maxHeightPx}px` }}
          onChange={(e) => {
            setValue(e.target.value);
            resize();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // Shift+Enter inserts a newline; a bare Enter (or Cmd/Ctrl+Enter) sends.
            if (e.shiftKey) return;
            // Enter also commits an in-flight IME composition, so it must not send.
            if (e.nativeEvent.isComposing) return;
            e.preventDefault();
            void submit();
          }}
        />
        {collapsed ? (
          <div
            className="absolute inset-0 flex items-center px-4 cursor-text"
            onClick={focusEnd}
          >
            <span
              className={cn(
                "w-full truncate text-medium",
                value ? "text-input" : "text-input-placeholder",
              )}
            >
              {value || "Send a message"}
            </span>
          </div>
        ) : null}
      </div>
      {/* On a phone the settings glyph rides inside the pill until the field
          takes over the width, and Send always sits outside it. */}
      {!isMobile ? (
        sendButton
      ) : collapsed ? (
        <div className="absolute top-0 right-0">{settingsButton}</div>
      ) : null}
    </div>
  );

  return (
    <form
      className={cn(
        "flex flex-col",
        isMobile
          ? "gap-3 px-2 pt-8 pb-8"
          : isTablet
            ? "gap-3 px-2 pt-2 pb-4 rounded-[12px] bg-elevation-level-1 shadow-2xl"
            : "gap-4 p-4 rounded-[8px] bg-elevation-level-1 shadow-2xl",
      )}
      style={isMobile ? GROUND_FADE_UP : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {isMobile ? (
        <div className="flex items-end gap-2">
          {field}
          {sendButton}
        </div>
      ) : (
        field
      )}

      {/* The status line wraps rather than letting its `shrink-0` chips run
          into each other once the chat column is narrow. */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-[10px]",
          // The glyph inside the pill already carries the row's left margin.
          isMobile && "pl-2",
        )}
      >
        <div className="flex flex-1 min-w-0 flex-wrap items-center gap-y-1 gap-x-4">
          {/* A phone's settings glyph lives in the pill instead. */}
          {isMobile ? null : settingsButton}

          {/* The model name is the first thing a narrow column gives up; the
              same switch lives in the session settings the gear opens. */}
          {narrow ? null : (
            <ModelPicker
              sessionId={sessionId}
              metadata={snapshot?.metadata ?? null}
              label={metrics.model}
              disabled={busy}
            />
          )}

          {isSsh ? (
            <SshBadge
              state={sshStatus === "connected" ? "connected" : "reconnect"}
              onReconnect={() => void reconnectSsh()}
            />
          ) : (
            <span className="text-[10px] leading-[12px] font-medium uppercase text-basic-tertiary shrink-0">
              {metrics.env}
            </span>
          )}

          {metrics.usage ? (
            <div className="flex items-center gap-[2px] min-w-0">
              {/* The backend reports the live context window here, not a sum
                  of the columns beside it. */}
              <StatBadge
                iconName={IconName.Timelaps}
                value={context.value}
                className="text-info-primary"
                title={context.title}
              />
              {/* The per-direction columns go with the model name, leaving the
                  narrow row the reading that matters. */}
              {narrow ? null : (
                <>
                  <StatBadge
                    iconName={IconName.ArrowTop}
                    value={formatTokensCompact(metrics.usage.input_tokens)}
                    className="text-info-secondary opacity-75"
                    title="Input tokens"
                  />
                  {metrics.usage.cache_read_tokens > 0 ? (
                    <StatBadge
                      prefix="C"
                      value={formatTokensCompact(
                        metrics.usage.cache_read_tokens,
                      )}
                      className="text-info-secondary opacity-75"
                      title="Cache read tokens"
                    />
                  ) : null}
                  <StatBadge
                    iconName={IconName.ArrowDown}
                    value={formatTokensCompact(metrics.usage.output_tokens)}
                    className="text-info-secondary opacity-75"
                    title="Output tokens"
                  />
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-[10px] shrink-0">
          {/* Priced from the model catalog, so a model the catalog has no
              rates for shows "--" rather than a misleading zero. */}
          {metrics.usage ? (
            <StatBadge
              iconName={IconName.Price}
              iconSize={16}
              value={formatCostMicros(metrics.usage.cost?.total)}
              className="text-basic-primary"
              title="Session cost"
              showIcon={false}
            />
          ) : null}

          <Tooltip
            title={running ? "Run elapsed" : "Last response time"}
            position={TooltipPosition.TopRight}
          >
            <div
              className={cn(
                "flex items-center gap-1 p-1 shrink-0 label-micro",
                running ? "text-basic-primary" : "text-basic-tertiary",
              )}
            >
              {/* The narrow row reads as the bare clock, with the Stop
                  affordance beside the field carrying the run's state. */}
              {narrow ? null : running ? (
                <Loader size={LoaderSize.Small} />
              ) : (
                <Icon iconName={IconName.History} size={16} />
              )}
              <span className="block w-[40px] text-center">
                {formatClock(elapsedMs)}
              </span>
            </div>
          </Tooltip>
        </div>
      </div>
    </form>
  );
}
